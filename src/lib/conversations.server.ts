import { GenerationRepository } from "./generation-settings.server";
import type { GenerationPerformance } from "./generation-config";
import { InternetRepository } from "./internet.server";
import { MemoryRepository } from "./memories.server";
import { DocumentRepository } from "./documents.server";
import { cancelDocumentJob } from "./document-processing.server";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, platform } from "node:os";
import type { Conversation, ConversationSummary, StoredMessage } from "./types";

export class ConversationError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}
export function conversationTitle(content: string) {
  const chars = Array.from(content.replace(/\s+/gu, " ").trim());
  return chars.length > 60 ? chars.slice(0, 59).join("") + "…" : chars.join("");
}
export function conversationDirectory() {
  if (process.env["REBEL_AI_DATA_DIR"]) return process.env["REBEL_AI_DATA_DIR"];
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "Rebel AI");
  if (platform() === "win32")
    return join(process.env["LOCALAPPDATA"] || join(homedir(), "AppData", "Local"), "Rebel AI");
  return join(process.env["XDG_DATA_HOME"] || join(homedir(), ".local", "share"), "rebel-ai");
}

export class ConversationRepository {
  private db: DatabaseSync;
  readonly documents: DocumentRepository;
  private generationRepository?: GenerationRepository;
  get generation() {
    return (this.generationRepository ??= new GenerationRepository(this.db));
  }
  private internetRepository?: InternetRepository;
  get internet() {
    return (this.internetRepository ??= new InternetRepository(this.db));
  }
  private webSearch(id: string) {
    try {
      return this.internet.get(id);
    } catch {
      return undefined;
    }
  }
  private memoryRepository?: MemoryRepository;
  get memories() {
    return (this.memoryRepository ??= new MemoryRepository(this.db));
  }
  private memoryUsed(id: string) {
    try {
      return this.memories.wasUsed(id);
    } catch {
      return false;
    }
  }
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL, modelTag TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL,
        createdAt TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','complete','interrupted','error'))
      );
      CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversationId);
      CREATE UNIQUE INDEX IF NOT EXISTS one_generation_per_conversation ON messages(conversationId) WHERE status='pending';
      UPDATE messages SET status='interrupted' WHERE status='pending';`);
    if (
      !this.db
        .prepare("PRAGMA table_info(conversations)")
        .all()
        .some((column) => column["name"] === "customTitle")
    ) {
      this.db.exec("ALTER TABLE conversations ADD COLUMN customTitle INTEGER NOT NULL DEFAULT 0");
    }
    this.documents = new DocumentRepository(this.db, dirname(path));
  }
  close() {
    this.db.close();
  }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  list(): ConversationSummary[] {
    return this.db
      .prepare("SELECT * FROM conversations ORDER BY updatedAt DESC, rowid DESC")
      .all() as unknown as ConversationSummary[];
  }
  get(id: string): Conversation {
    const conversation = this.db
      .prepare("SELECT * FROM conversations WHERE id=?")
      .get(id) as unknown as ConversationSummary | undefined;
    if (!conversation) throw new ConversationError("This conversation no longer exists.", 404);
    const messages = this.db
      .prepare("SELECT * FROM messages WHERE conversationId=? ORDER BY rowid")
      .all(id) as unknown as StoredMessage[];
    return {
      ...conversation,
      messages: messages.map((m) => ({
        ...m,
        sources: this.documents.sources(m.id),
        memoryUsed: this.memoryUsed(m.id),
        webSearch: this.webSearch(m.id),
        performance: this.generation.performance(m.id),
      })),
    };
  }
  create(id: string, modelTag: string | null): Conversation {
    const now = new Date().toISOString();
    // A stable client ID makes retrying a lost creation response safe.
    this.db
      .prepare(
        "INSERT OR IGNORE INTO conversations (id,title,createdAt,updatedAt,modelTag) VALUES (?, 'New chat', ?, ?, ?)",
      )
      .run(id, now, now, modelTag);
    return this.get(id);
  }
  update(id: string, modelTag: string | null): Conversation {
    if (this.get(id).messages.some((m) => m.status === "pending"))
      throw new ConversationError("Stop the current reply before changing models.", 409);
    this.db
      .prepare("UPDATE conversations SET modelTag=?, updatedAt=? WHERE id=?")
      .run(modelTag, new Date().toISOString(), id);
    return this.get(id);
  }
  delete(id: string) {
    for (const file of this.documents.list(id)) {
      cancelDocumentJob(file.id);
      this.documents.delete(id, file.id);
    }
    this.db.prepare("DELETE FROM conversations WHERE id=?").run(id);
  }
  beginTurn(id: string, messageId: string, content: string, modelTag: string): Conversation {
    return this.transaction(() => {
      const conversation = this.get(id);
      if (conversation.messages.some((m) => m.status === "pending"))
        throw new ConversationError(
          "A reply is already being generated in this conversation.",
          409,
        );
      if (this.db.prepare("SELECT id FROM messages WHERE id=?").get(messageId))
        throw new ConversationError(
          "This message was already saved. Reload the conversation before retrying.",
          409,
        );
      const now = new Date().toISOString();
      const insert = this.db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)");
      insert.run(messageId, id, "user", content, now, "complete");
      insert.run(`${messageId}:assistant`, id, "assistant", "", now, "pending");
      this.db
        .prepare("UPDATE conversations SET title=?, modelTag=?, updatedAt=? WHERE id=?")
        .run(
          this.hasCustomTitle(id) || conversation.messages.some((m) => m.role === "user")
            ? conversation.title
            : conversationTitle(content),
          modelTag,
          now,
          id,
        );
      return this.get(id);
    });
  }
  private hasCustomTitle(id: string) {
    return Boolean(
      this.db.prepare("SELECT customTitle FROM conversations WHERE id=?").get(id)?.["customTitle"],
    );
  }
  rename(id: string, title: string): Conversation {
    const value = title.trim();
    if (!value || value.length > 100)
      throw new ConversationError("Use a title between 1 and 100 characters.", 400);
    this.get(id);
    this.db
      .prepare("UPDATE conversations SET title=?, customTitle=1, updatedAt=? WHERE id=?")
      .run(value, new Date().toISOString(), id);
    return this.get(id);
  }
  reviseTurn(
    id: string,
    requestId: string,
    revision: { kind: "regenerate" | "edit"; userMessageId: string; expectedTailId: string },
    content: string,
    modelTag: string,
  ): Conversation {
    return this.transaction(() => {
      const conversation = this.get(id);
      if (conversation.messages.some((m) => m.status === "pending"))
        throw new ConversationError(
          "A reply is already being generated in this conversation.",
          409,
        );
      const tail = conversation.messages.at(-1);
      if (tail?.id !== revision.expectedTailId)
        throw new ConversationError("History changed. Reload before replacing messages.", 409);
      const targetIndex = conversation.messages.findIndex(
        (m) => m.id === revision.userMessageId && m.role === "user",
      );
      const target = conversation.messages[targetIndex];
      if (!target) throw new ConversationError("The original message no longer exists.", 409);
      if (
        revision.kind === "regenerate" &&
        (targetIndex !== conversation.messages.length - 2 || tail?.role !== "assistant")
      )
        throw new ConversationError("Only the latest reply can be regenerated.", 409);
      if (conversation.modelTag !== modelTag)
        throw new ConversationError("The selected model changed. Reload before trying again.", 409);
      if (!content.trim() || content.length > 200000)
        throw new ConversationError("Enter a message of at most 200000 characters.", 400);
      if (this.db.prepare("SELECT id FROM messages WHERE id=?").get(`${requestId}:assistant`))
        throw new ConversationError("This replacement was already saved. Reload history.", 409);
      // Cascades remove stale web/document citations and memory-use metadata.
      this.db
        .prepare(
          "DELETE FROM messages WHERE conversationId=? AND rowid>(SELECT rowid FROM messages WHERE id=?)",
        )
        .run(id, target.id);
      if (revision.kind === "edit")
        this.db.prepare("UPDATE messages SET content=? WHERE id=?").run(content.trim(), target.id);
      const now = new Date().toISOString();
      this.db
        .prepare("INSERT INTO messages VALUES (?, ?, 'assistant', '', ?, 'pending')")
        .run(`${requestId}:assistant`, id, now);
      if (revision.kind === "edit" && targetIndex === 0 && !this.hasCustomTitle(id))
        this.db
          .prepare("UPDATE conversations SET title=? WHERE id=?")
          .run(conversationTitle(content), id);
      this.db.prepare("UPDATE conversations SET updatedAt=? WHERE id=?").run(now, id);
      return this.get(id);
    });
  }
  saveReply(
    id: string,
    content: string,
    status: StoredMessage["status"],
    performance?: GenerationPerformance,
  ) {
    this.transaction(() => {
      const result = this.db
        .prepare("UPDATE messages SET content=?, status=? WHERE id=? AND status='pending'")
        .run(content, status, id);
      if (Number(result.changes) !== 1)
        throw new ConversationError(
          "This reply is no longer active. The conversation may have been deleted.",
          409,
        );
      if (performance) this.generation.savePerformance(id, performance);
      this.db
        .prepare(
          "UPDATE conversations SET updatedAt=? WHERE id=(SELECT conversationId FROM messages WHERE id=?)",
        )
        .run(new Date().toISOString(), id);
    });
  }
}

// Keep the one local connection across Vite module reloads. A process restart
// opens it again and recovers unfinished replies. Run one server per data folder.
const local = globalThis as typeof globalThis & { rebelConversations?: ConversationRepository };
export function getConversations() {
  // Upgrade a development server that already held the pre-internet repository.
  if (local.rebelConversations && !Reflect.has(local.rebelConversations, "generation")) {
    local.rebelConversations.close();
    delete local.rebelConversations;
  }
  return (local.rebelConversations ??= new ConversationRepository(
    join(conversationDirectory(), "conversations.sqlite"),
  ));
}
