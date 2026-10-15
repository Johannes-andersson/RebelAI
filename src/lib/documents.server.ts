/* eslint-disable no-control-regex -- reject unsafe filename and path characters */
import type { DatabaseSync } from "node:sqlite";
import { isImage, relativePath as safePath } from "./attachment-config";
import { validateImage } from "./image-input.server";
import { randomUUID, createHash } from "node:crypto";
import { DocumentStorage } from "./document-storage.server";
import {
  DocumentError,
  documentLimits,
  type AttachedDocument,
  type IndexedChunk,
  type DocumentSource,
} from "./document-config";

export class DocumentRepository {
  readonly storage: DocumentStorage;
  constructor(
    private db: DatabaseSync,
    directory: string,
  ) {
    this.storage = new DocumentStorage(directory);
    db.exec(`CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      filename TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, createdAt TEXT NOT NULL,
      status TEXT NOT NULL, error TEXT, embeddingModel TEXT);
      CREATE INDEX IF NOT EXISTS document_conversation ON documents(conversationId);
      CREATE TABLE IF NOT EXISTS document_chunks (
        fileId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunkIndex INTEGER NOT NULL, page INTEGER, text TEXT NOT NULL, vector TEXT NOT NULL,
        PRIMARY KEY(fileId, chunkIndex));
      CREATE TABLE IF NOT EXISTS message_sources (
        messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        fileId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunkIndex INTEGER NOT NULL, page INTEGER, text TEXT NOT NULL,
        PRIMARY KEY(messageId, fileId, chunkIndex));
      UPDATE documents SET status='error', error='Processing was interrupted. Retry indexing this file.'
        WHERE status IN ('importing','extracting','preparing','indexing');
      UPDATE documents SET error='The local document-search component could not be prepared. Retry to continue.'
        WHERE status='error' AND error LIKE '%ollama pull%';`);
    const columns = db.prepare("PRAGMA table_info(documents)").all();
    if (!columns.some((c) => c["name"] === "relativePath"))
      db.exec("ALTER TABLE documents ADD COLUMN relativePath TEXT NOT NULL DEFAULT ''");
    if (!columns.some((c) => c["name"] === "contentHash"))
      db.exec("ALTER TABLE documents ADD COLUMN contentHash TEXT");
    db.exec(
      `CREATE TABLE IF NOT EXISTS message_attachments (messageId TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, fileId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, PRIMARY KEY(messageId,fileId));`,
    );
  }
  library(): (AttachedDocument & { conversationTitle: string })[] {
    for (const row of this.db.prepare("SELECT id FROM documents WHERE status='ready'").all()) {
      const id = String(row["id"]);
      if (!this.storage.exists(id))
        this.state(
          id,
          "error",
          "The local file is missing. Remove it and attach the original again.",
        );
    }
    return this.db
      .prepare(
        `SELECT d.*, c.title AS conversationTitle FROM documents d
      JOIN conversations c ON c.id=d.conversationId ORDER BY d.createdAt DESC,d.rowid DESC`,
      )
      .all() as unknown as (AttachedDocument & { conversationTitle: string })[];
  }
  list(conversationId: string): AttachedDocument[] {
    return this.db
      .prepare("SELECT * FROM documents WHERE conversationId=? ORDER BY createdAt, rowid")
      .all(conversationId) as unknown as AttachedDocument[];
  }
  get(conversationId: string, id: string) {
    const file = this.list(conversationId).find((f) => f.id === id);
    if (!file) throw new DocumentError("This attachment no longer exists.", 404);
    return file;
  }
  create(conversationId: string, filename: string, data: Uint8Array, path = "") {
    const relativePath = safePath(path);
    const name =
      filename
        .split(/[\\/]/)
        .pop()
        // Strip control characters from uploaded filenames.
        ?.replace(/[\u0000-\u001f\u007f]/g, "")
        .trim() ?? "";
    const extension = name.split(".").pop()?.toLowerCase();
    const type = extension === "markdown" ? "md" : extension === "jpeg" ? "jpg" : extension;
    if (
      !name ||
      name.length > 255 ||
      !["pdf", "txt", "md", "jpg", "png", "webp"].includes(type ?? "")
    )
      throw new DocumentError("Unsupported file type. Use PDF, TXT, Markdown, JPEG, PNG, or WebP.");
    if (!data.length || data.length > documentLimits.bytes)
      throw new DocumentError("Choose a non-empty file no larger than 10 MB.", 413);
    if (isImage(type!)) validateImage(data, type!);
    const hash = createHash("sha256").update(data).digest("hex");
    const duplicate = this.db
      .prepare(
        "SELECT id FROM documents WHERE conversationId=? AND contentHash=? AND relativePath=?",
      )
      .get(conversationId, hash, relativePath);
    if (duplicate) return this.get(conversationId, String(duplicate["id"]));
    const total = Number(
      this.db.prepare("SELECT COALESCE(SUM(size),0) AS bytes FROM documents").get()?.["bytes"],
    );
    if (total + data.length > documentLimits.totalBytes)
      throw new DocumentError(
        "Local file storage limit reached (1 GB). Remove files before importing more.",
        413,
      );
    if (!this.db.prepare("SELECT id FROM conversations WHERE id=?").get(conversationId))
      throw new DocumentError("This conversation no longer exists.", 404);
    if (this.list(conversationId).length >= documentLimits.files)
      throw new DocumentError("A conversation can have up to 100 attachments.");
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO documents (id,conversationId,filename,type,size,createdAt,status,error,embeddingModel,relativePath,contentHash) VALUES (?, ?, ?, ?, ?, ?, 'importing', NULL, NULL, ?, ?)",
      )
      .run(
        id,
        conversationId,
        name,
        type!,
        data.length,
        new Date().toISOString(),
        relativePath,
        hash,
      );
    try {
      this.storage.write(id, data);
    } catch {
      this.db.prepare("DELETE FROM documents WHERE id=?").run(id);
      throw new DocumentError(
        "Could not store the file locally. Check disk space and folder permissions.",
        500,
      );
    }
    return this.get(conversationId, id);
  }
  state(id: string, status: AttachedDocument["status"], error: string | null = null) {
    if (
      !this.db.prepare("UPDATE documents SET status=?, error=? WHERE id=?").run(status, error, id)
        .changes
    )
      throw new DocumentError("This attachment was removed.", 404);
  }
  index(id: string, model: string, chunks: IndexedChunk[]) {
    const count = Number(
      this.db.prepare("SELECT COUNT(*) AS n FROM document_chunks WHERE fileId<>?").get(id)?.["n"],
    );
    if (count + chunks.length > documentLimits.totalChunks)
      throw new DocumentError(
        "Local search index limit reached (6000 excerpts). Remove unneeded documents and retry.",
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM document_chunks WHERE fileId=?").run(id);
      const insert = this.db.prepare("INSERT INTO document_chunks VALUES (?, ?, ?, ?, ?)");
      for (const chunk of chunks)
        insert.run(id, chunk.index, chunk.page, chunk.text, JSON.stringify(chunk.vector));
      if (
        !this.db
          .prepare("UPDATE documents SET status='ready', error=NULL, embeddingModel=? WHERE id=?")
          .run(model, id).changes
      )
        throw new DocumentError("This attachment was removed.", 404);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  chunks(
    conversationId: string,
    ids?: string[],
  ): (DocumentSource & { vector: number[]; model: string })[] {
    const rows = this.db
      .prepare(
        `SELECT c.fileId, d.filename, c.chunkIndex, c.page, c.text, c.vector, d.embeddingModel AS model
      FROM document_chunks c JOIN documents d ON d.id=c.fileId
      WHERE ${ids ? `d.id IN (${ids.map(() => "?").join(",") || "NULL"})` : "d.conversationId=?"} AND d.status='ready' ORDER BY d.createdAt,c.chunkIndex`,
      )
      .all(...(ids ?? [conversationId]));
    return rows.map((r) => ({
      ...r,
      vector: JSON.parse(r["vector"] as string),
    })) as (DocumentSource & { vector: number[]; model: string })[];
  }
  saveSources(messageId: string, sources: DocumentSource[]) {
    const insert = this.db.prepare("INSERT INTO message_sources VALUES (?, ?, ?, ?, ?)");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const s of sources) insert.run(messageId, s.fileId, s.chunkIndex, s.page, s.text);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  sources(messageId: string): DocumentSource[] {
    return this.db
      .prepare(
        `SELECT s.fileId,d.filename,s.chunkIndex,s.page,s.text FROM message_sources s
      JOIN documents d ON d.id=s.fileId WHERE s.messageId=? ORDER BY s.rowid`,
      )
      .all(messageId) as unknown as DocumentSource[];
  }
  find(id: string) {
    const row = this.db.prepare("SELECT * FROM documents WHERE id=?").get(id) as unknown as
      AttachedDocument | undefined;
    if (!row) throw new DocumentError("This local file no longer exists.", 404);
    return row;
  }
  attach(messageId: string, ids: string[]) {
    const statement = this.db.prepare("INSERT OR IGNORE INTO message_attachments VALUES (?,?)");
    for (const id of ids) statement.run(messageId, id);
  }
  attachments(messageId: string): AttachedDocument[] {
    return this.db
      .prepare(
        "SELECT d.* FROM documents d JOIN message_attachments a ON a.fileId=d.id WHERE a.messageId=?",
      )
      .all(messageId) as unknown as AttachedDocument[];
  }
  rename(conversationId: string, id: string, name: string, path: string) {
    const file = this.get(conversationId, id);
    if (!name.trim() || name.length > 255 || /[\\/\x00-\x1f]/.test(name))
      throw new DocumentError("Choose a valid filename.");
    const ext = name.split(".").pop()?.toLowerCase();
    const type = ext === "jpeg" ? "jpg" : ext === "markdown" ? "md" : ext;
    if (type !== file.type) throw new DocumentError("Keep the original file extension.");
    this.db
      .prepare("UPDATE documents SET filename=?,relativePath=? WHERE id=?")
      .run(name.trim(), safePath(path), id);
    return this.get(conversationId, id);
  }
  preserveShared(conversationId: string, id: string) {
    const reference = this.db
      .prepare(
        `SELECT m.conversationId FROM messages m JOIN (
      SELECT messageId FROM message_sources WHERE fileId=? UNION SELECT messageId FROM message_attachments WHERE fileId=?
    ) r ON r.messageId=m.id WHERE m.conversationId<>? LIMIT 1`,
      )
      .get(id, id, conversationId);
    if (!reference) return false;
    this.db
      .prepare("UPDATE documents SET conversationId=? WHERE id=?")
      .run(String(reference["conversationId"]), id);
    return true;
  }
  delete(conversationId: string, id: string) {
    this.get(conversationId, id);
    this.storage.remove(id);
    this.db
      .prepare("DELETE FROM documents WHERE id=? AND conversationId=?")
      .run(id, conversationId);
  }
}
