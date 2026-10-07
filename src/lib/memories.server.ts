import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  MemoryError,
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
        "SELECT id,content,createdAt,updatedAt,sourceConversationId FROM memories ORDER BY createdAt DESC,rowid DESC",
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
  create(content: string, sourceConversationId: string | null): SavedMemory | null {
    if (!this.settings().enabled) return null;
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
      createdAt: now,
      updatedAt: now,
      sourceConversationId: source,
    };
    this.db
      .prepare("INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)")
      .run(saved.id, saved.content, normalized, now, now, source);
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
