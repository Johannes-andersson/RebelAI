import type { DocumentRepository } from "./documents.server";
import { extractText } from "./document-extraction.server";
import { chunkPages } from "./document-chunks";
import { localEmbedder, type EmbeddingProvider } from "./embeddings.server";
import { DocumentError, type IndexedChunk } from "./document-config";

// Preserve active jobs across development hot reloads. A true process restart
// marks interrupted jobs as errors in the repository constructor.
const globalJobs = globalThis as typeof globalThis & {
  rebelDocumentJobs?: Map<string, AbortController>;
};
const jobs = (globalJobs.rebelDocumentJobs ??= new Map<string, AbortController>());
export function cancelDocumentJob(id: string) {
  jobs.get(id)?.abort();
}
export async function processDocument(
  db: DocumentRepository,
  conversationId: string,
  id: string,
  provider: EmbeddingProvider = localEmbedder(),
  signal?: AbortSignal,
) {
  try {
    const file = db.get(conversationId, id);
    db.state(id, "extracting");
    const pages = await extractText(db.storage.read(id), file.type);
    signal?.throwIfAborted();
    const chunks = chunkPages(pages);
    if (provider.prepare) {
      db.state(id, "preparing");
      await provider.prepare(signal);
      signal?.throwIfAborted();
    }
    db.state(id, "indexing");
    const indexed: IndexedChunk[] = [];
    for (let i = 0; i < chunks.length; i += 8) {
      signal?.throwIfAborted();
      const batch = chunks.slice(i, i + 8);
      const vectors = await provider.embed(
        batch.map((c) => c.text),
        signal,
      );
      batch.forEach((c, index) => indexed.push({ ...c, vector: vectors[index]! }));
    }
    signal?.throwIfAborted();
    db.index(id, provider.model, indexed);
  } catch (error) {
    try {
      db.state(
        id,
        "error",
        signal?.aborted
          ? "Processing was interrupted. Retry indexing this file."
          : error instanceof DocumentError
            ? error.message
            : "Could not index this file locally. Check disk space and Ollama, then retry.",
      );
    } catch {
      /* The attachment or conversation was removed. */
    }
  }
}
export function startDocumentJob(db: DocumentRepository, conversationId: string, id: string) {
  if (jobs.has(id)) throw new DocumentError("This file is already being processed.", 409);
  if (jobs.size >= 2)
    throw new DocumentError(
      "Two files are already processing. Wait for one to finish, then retry.",
      429,
    );
  const controller = new AbortController();
  jobs.set(id, controller);
  void processDocument(db, conversationId, id, localEmbedder(), controller.signal).finally(() =>
    jobs.delete(id),
  );
}
