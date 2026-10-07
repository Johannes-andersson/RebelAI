import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
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
  create(conversationId: string, filename: string, data: Uint8Array) {
    if (!this.db.prepare("SELECT id FROM conversations WHERE id=?").get(conversationId))
      throw new DocumentError("This conversation no longer exists.", 404);
    if (this.list(conversationId).length >= documentLimits.files)
      throw new DocumentError("A conversation can have up to 20 attachments.");
    const name =
      filename
        .split(/[\\/]/)
        .pop()
        ?.replace(/[\u0000-\u001f\u007f]/g, "")
        .trim() ?? "";
    const extension = name.split(".").pop()?.toLowerCase();
    const type = extension === "markdown" ? "md" : extension;
    if (!name || name.length > 255 || !["pdf", "txt", "md"].includes(type ?? ""))
      throw new DocumentError("Unsupported file type. Attach a PDF, TXT, or Markdown file.");
    if (!data.length || data.length > documentLimits.bytes)
      throw new DocumentError("Choose a non-empty file no larger than 10 MB.", 413);
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, 'importing', NULL, NULL)")
      .run(id, conversationId, name, type!, data.length, new Date().toISOString());
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
  chunks(conversationId: string): (DocumentSource & { vector: number[]; model: string })[] {
    const rows = this.db
      .prepare(
        `SELECT c.fileId, d.filename, c.chunkIndex, c.page, c.text, c.vector, d.embeddingModel AS model
      FROM document_chunks c JOIN documents d ON d.id=c.fileId
      WHERE d.conversationId=? AND d.status='ready' ORDER BY d.createdAt,c.chunkIndex`,
      )
      .all(conversationId);
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
  delete(conversationId: string, id: string) {
    this.get(conversationId, id);
    this.storage.remove(id);
    this.db
      .prepare("DELETE FROM documents WHERE id=? AND conversationId=?")
      .run(id, conversationId);
  }
}
