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
      })),
    };
  }
  create(id: string, modelTag: string | null): Conversation {
    const now = new Date().toISOString();
    // A stable client ID makes retrying a lost creation response safe.
    this.db
      .prepare("INSERT OR IGNORE INTO conversations VALUES (?, 'New chat', ?, ?, ?)")
      .run(id, now, now, modelTag);
    return this.get(id);
  }
  update(id: string, modelTag: string | null): Conversation {
    this.get(id);
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
          conversation.messages.some((m) => m.role === "user")
            ? conversation.title
            : conversationTitle(content),
          modelTag,
          now,
          id,
        );
      return this.get(id);
    });
  }
  saveReply(id: string, content: string, status: StoredMessage["status"]) {
    this.transaction(() => {
      const result = this.db
        .prepare("UPDATE messages SET content=?, status=? WHERE id=? AND status='pending'")
        .run(content, status, id);
      if (Number(result.changes) !== 1)
        throw new ConversationError(
          "This reply is no longer active. The conversation may have been deleted.",
          409,
        );
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
  // Upgrade a development server that already held the pre-memory repository.
  if (local.rebelConversations && !Reflect.has(local.rebelConversations, "memories")) {
    local.rebelConversations.close();
    delete local.rebelConversations;
  }
  return (local.rebelConversations ??= new ConversationRepository(
    join(conversationDirectory(), "conversations.sqlite"),
  ));
}
