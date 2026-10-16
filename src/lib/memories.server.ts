import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  MemoryError,
  assertSafeMemory,
  memoryActionSchema,
  type MemoryAction,
  memoryLimits,
  memorySchema,
  validVector,
  type SavedMemory,
} from "./memory-config";
export interface IndexedMemory extends SavedMemory {
  embedding: number[] | null;
  embeddingModel: string | null;
}
export class MemoryRepository {
  constructor(private db: DatabaseSync) {
    // Same SQLite connection and additive schema approach as documents/history.
    db.exec(`CREATE TABLE IF NOT EXISTS memory_settings (
      id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO memory_settings VALUES (1,1,0);
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, normalized TEXT NOT NULL UNIQUE,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        sourceConversationId TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        embedding TEXT, embeddingModel TEXT);
      CREATE TABLE IF NOT EXISTS message_memory_usage (
        messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE);`);
    if (
      !db
        .prepare("PRAGMA table_info(memories)")
        .all()
        .some((c) => c["name"] === "category")
    )
      db.exec("ALTER TABLE memories ADD COLUMN category TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS memory_actions(messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_receipts(userMessageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,data TEXT NOT NULL);`);
  }
  action(id: string) {
    const r = this.db.prepare("SELECT data FROM memory_actions WHERE messageId=?").get(id);
    return r ? memoryActionSchema.parse(JSON.parse(String(r["data"]))) : undefined;
  }
  stage(
    id: string,
    userMessageId: string,
    input: Pick<
      MemoryAction,
      "operation" | "targetId" | "expectedUpdatedAt" | "content" | "category"
    >,
  ) {
    assertSafeMemory(input.content);
    assertSafeMemory(input.category);
    const receipt = this.db
      .prepare("SELECT data FROM memory_receipts WHERE userMessageId=?")
      .get(userMessageId);
    const a: MemoryAction = receipt
      ? { ...JSON.parse(String(receipt["data"])), id }
      : {
          ...input,
          id,
          userMessageId,
          status: "pending",
          createdAt: new Date().toISOString(),
          resultId: null,
        };
    memoryActionSchema.parse(a);
    this.db.prepare("INSERT INTO memory_actions VALUES (?,?)").run(id, JSON.stringify(a));
    return a;
  }
  edit(id: string, content: string, category: string, expectedUpdatedAt: string) {
    assertSafeMemory(content);
    assertSafeMemory(category);
    const old = this.list().find((m) => m.id === id);
    if (!old || old.updatedAt !== expectedUpdatedAt)
      throw new MemoryError("This memory changed. Refresh and review it again.", 409);
    const text = content.replace(/\s+/g, " ").trim();
    memorySchema.shape.content.parse(text);
    const normalized = text.toLocaleLowerCase("en-US");
    if (this.list().some((m) => m.id !== id && m.content.toLocaleLowerCase("en-US") === normalized))
      throw new MemoryError("That memory already exists.", 409);
    const now = new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString();
    this.db
      .prepare(
        "UPDATE memories SET content=?,normalized=?,category=?,updatedAt=?,embedding=NULL,embeddingModel=NULL WHERE id=?",
      )
      .run(text, normalized, category.slice(0, 80), now, id);
    this.db.exec("UPDATE memory_settings SET revision=revision+1 WHERE id=1");
    return this.list().find((m) => m.id === id)!;
  }
  decide(id: string, decision: "confirm" | "cancel", content?: string, category = "") {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const a = this.action(id);
      if (!a) throw new MemoryError("This memory preview no longer exists.", 409);
      const receipt = this.db
        .prepare("SELECT data FROM memory_receipts WHERE userMessageId=?")
        .get(a.userMessageId);
      if (receipt) {
        this.db.exec("COMMIT");
        return memoryActionSchema.parse(JSON.parse(String(receipt["data"])));
      }
      if (decision === "cancel") a.status = "cancelled";
      else {
        if (Date.now() - Date.parse(a.createdAt) > 86400000)
          throw new MemoryError("This preview expired. Send a new request.", 409);
        const original = this.list().find((m) => m.id === a.targetId);
        if (a.operation !== "create" && (!original || original.updatedAt !== a.expectedUpdatedAt))
          throw new MemoryError("This memory changed. Refresh and review it again.", 409);
        if (a.operation === "delete") {
          this.db.prepare("DELETE FROM memories WHERE id=?").run(a.targetId);
          this.db.exec("UPDATE memory_settings SET revision=revision+1 WHERE id=1");
        } else {
          if (!content) throw new MemoryError("Review the memory content.");
          assertSafeMemory(content);
          assertSafeMemory(category);
          a.content = content;
          a.category = category;
          const conversation = this.db
            .prepare("SELECT conversationId FROM messages WHERE id=?")
            .get(a.userMessageId);
          const saved =
            a.operation === "create"
              ? this.create(content, String(conversation?.["conversationId"] ?? ""), category)
              : this.edit(a.targetId!, content, category, a.expectedUpdatedAt!);
          if (!saved) throw new MemoryError("Memory is turned off. Enable it in Settings first.");
          a.resultId = saved.id;
        }
        a.status = "saved";
      }
      this.db
        .prepare("INSERT INTO memory_receipts VALUES (?,?)")
        .run(a.userMessageId, JSON.stringify(a));
      this.db
        .prepare("UPDATE memory_actions SET data=? WHERE messageId=?")
        .run(JSON.stringify(a), id);
      this.db.exec("COMMIT");
      return a;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  settings() {
    const row = this.db.prepare("SELECT enabled, revision FROM memory_settings WHERE id=1").get();
    if (!row || ![0, 1].includes(Number(row["enabled"])) || !Number.isInteger(row["revision"]))
      throw new MemoryError("Memory settings are unavailable. Please retry.", 500);
    return { enabled: row["enabled"] === 1, revision: Number(row["revision"]) };
  }
  setEnabled(enabled: boolean) {
    this.db
      .prepare("UPDATE memory_settings SET enabled=?,revision=revision+1 WHERE id=1")
      .run(Number(enabled));
  }
  list(): SavedMemory[] {
    return this.db
      .prepare(
        "SELECT id,content,category,createdAt,updatedAt,sourceConversationId FROM memories ORDER BY createdAt DESC,rowid DESC",
      )
      .all()
      .flatMap((row) => {
        const parsed = memorySchema.safeParse(row);
        return parsed.success ? [parsed.data] : [];
      });
  }
  candidates(): IndexedMemory[] {
    return this.db
      .prepare("SELECT * FROM memories ORDER BY createdAt DESC,rowid DESC LIMIT ?")
      .all(memoryLimits.records)
      .flatMap((row) => {
        const parsed = memorySchema.safeParse(row);
        if (!parsed.success) return [];
        let vector: unknown = null;
        try {
          vector = JSON.parse(String(row["embedding"]));
        } catch {
          /* Rebuild malformed vectors locally. */
        }
        return [
          {
            ...parsed.data,
            embedding: validVector(vector) ? vector : null,
            embeddingModel:
              typeof row["embeddingModel"] === "string" ? row["embeddingModel"] : null,
          },
        ];
      });
  }
  create(content: string, sourceConversationId: string | null, category = ""): SavedMemory | null {
    if (!this.settings().enabled) return null;
    assertSafeMemory(content);
    assertSafeMemory(category);
    const normalizedContent = content.replace(/\s+/g, " ").trim();
    if (!normalizedContent || normalizedContent.length > memoryLimits.characters)
      throw new MemoryError("Please keep each memory between 1 and 1,000 characters.");
    const normalized = normalizedContent.toLocaleLowerCase("en-US");
    const existing = this.db.prepare("SELECT * FROM memories WHERE normalized=?").get(normalized);
    if (existing) return memorySchema.parse(existing);
    if (
      Number(this.db.prepare("SELECT COUNT(*) AS count FROM memories").get()!["count"]) >=
      memoryLimits.records
    )
      throw new MemoryError(
        "Your memory list is full. Delete a saved memory in Settings before adding another.",
      );
    const source =
      sourceConversationId &&
      this.db.prepare("SELECT id FROM conversations WHERE id=?").get(sourceConversationId)
        ? sourceConversationId
        : null;
    const now = new Date().toISOString();
    const saved = {
      id: randomUUID(),
      content: normalizedContent,
      category: category.slice(0, 80),
      createdAt: now,
      updatedAt: now,
      sourceConversationId: source,
    };
    this.db
      .prepare(
        "INSERT INTO memories (id,content,normalized,createdAt,updatedAt,sourceConversationId,embedding,embeddingModel,category) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
      )
      .run(saved.id, saved.content, normalized, now, now, source, saved.category);
    return saved;
  }
  setEmbedding(id: string, vector: number[], model: string, revision: number) {
    if (!validVector(vector))
      throw new MemoryError("Could not prepare this memory for recall.", 500);
    const settings = this.settings();
    if (!settings.enabled || settings.revision !== revision) return;
    this.db
      .prepare("UPDATE memories SET embedding=?,embeddingModel=? WHERE id=?")
      .run(JSON.stringify(vector), model, id);
  }
  delete(id?: string) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (id) this.db.prepare("DELETE FROM memories WHERE id=?").run(id);
      else this.db.exec("DELETE FROM memories");
      this.db.exec("UPDATE memory_settings SET revision=revision+1 WHERE id=1; COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  unchanged(revision: number) {
    const settings = this.settings();
    return settings.enabled && settings.revision === revision;
  }
  markUsed(messageId: string) {
    this.db.prepare("INSERT OR IGNORE INTO message_memory_usage VALUES (?)").run(messageId);
  }
  wasUsed(messageId: string) {
    return !!this.db
      .prepare("SELECT messageId FROM message_memory_usage WHERE messageId=?")
      .get(messageId);
  }
}
