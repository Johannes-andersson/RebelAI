import { ollamaUrl } from "./ollama-config.server";
import { embeddingModel } from "./embedding-config.server";
export { embeddingModel } from "./embedding-config.server";
import { pullOllamaModel } from "./ollama-pull.server";
import { readInstallProgress } from "./model-pull-progress";
import type { DocumentSearchStatus } from "./document-config";
import { DocumentError } from "./document-config";

export function localOllamaUrl(path: string) {
  const url = ollamaUrl(path);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password)
    throw new DocumentError(
      "Document search requires a local connection on this computer. Check the local runtime connection in app settings.",
    );
  return url;
}
async function localRequest(path: string, body: unknown, signal?: AbortSignal) {
  let response: Response;
  const url = localOllamaUrl(path);
  try {
    response = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
        : AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new DocumentError(
      "Document search cannot reach the local AI runtime. Open the Ollama app on this computer, then retry.",
      503,
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 404)
      throw new DocumentError("The local AI component is unavailable. Please retry.", 404);
    throw new DocumentError(
      "The local document-search component could not complete the request. Please retry.",
      502,
    );
  }
  return data;
}
export async function requireLocalModel(model: string, signal?: AbortSignal) {
  if (/(?:^|[-:])cloud(?:$|[-:])/i.test(model))
    throw new DocumentError("Document search requires a local model, not a cloud model.");
  const data = await localRequest("show", { model }, signal);
  if (!data || typeof data !== "object")
    throw new DocumentError(
      "The local AI runtime returned an invalid response. Please retry.",
      502,
    );
  if (data.remote_host || data.remote_model || /(?:^|[-:])cloud(?:$|[-:])/i.test(model))
    throw new DocumentError(
      "Attached files can only be used with a locally installed model. Select a local model instead of a cloud model.",
    );
}
export interface EmbeddingProvider {
  model: string;
  prepare?(signal?: AbortSignal): Promise<void>;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
export function localEmbedder(): EmbeddingProvider {
  const model = embeddingModel();
  return {
    model,
    prepare: (signal) => prepareDocumentSearch(signal, model),
    async embed(texts, signal) {
      await prepareDocumentSearch(signal, model);
      const data = await localRequest("embed", { model, input: texts, truncate: false }, signal);
      const vectors: unknown = data?.embeddings;
      if (
        !Array.isArray(vectors) ||
        vectors.length !== texts.length ||
        !vectors.every(
          (v) =>
            Array.isArray(v) &&
            v.length > 0 &&
            v.length <= 8192 &&
            v.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) &&
            v.some((n: number) => n !== 0),
        ) ||
        !vectors.every((v) => v.length === vectors[0].length)
      )
        throw new DocumentError(
          "The document-search component returned invalid results. Please retry.",
          502,
        );
      return vectors as number[][];
    },
  };
}

interface SearchPreparation {
  state: DocumentSearchStatus;
  pending?: Promise<void> | undefined;
}
const local = globalThis as typeof globalThis & {
  rebelSearchPreparations?: Map<string, SearchPreparation>;
};
const preparations = (local.rebelSearchPreparations ??= new Map<string, SearchPreparation>());
function preparation(model: string) {
  const key = `${localOllamaUrl("show").href}/${model}`;
  let entry = preparations.get(key);
  if (!entry) {
    entry = { state: { status: "idle", progress: null, error: null } };
    preparations.set(key, entry);
  }
  return entry;
}
export function documentSearchStatus(): DocumentSearchStatus {
  try {
    return preparation(embeddingModel()).state;
  } catch (error) {
    return { status: "error", progress: null, error: friendlyPreparationError(error) };
  }
}
function friendlyPreparationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (error instanceof DocumentError && error.status === 400) return message;
  return /space|enospc|disk.*full/i.test(message)
    ? "The local document-search component could not be installed because there is not enough disk space. Free some space, then retry."
    : "The local document-search component could not be installed or started. Check your internet connection and that the Ollama app is open, then retry.";
}
// All callers share a single preparation per runtime/model. Cancelling a file or
// question stops its wait, but does not cancel a component needed by other files.
export async function prepareDocumentSearch(signal?: AbortSignal, model = embeddingModel()) {
  signal?.throwIfAborted();
  const entry = preparation(model);
  if (!entry.pending) {
    entry.state = { status: "preparing", progress: null, error: null };
    const task = (async () => {
      const deadline = AbortSignal.timeout(30 * 60 * 1000);
      try {
        try {
          await requireLocalModel(model, deadline);
        } catch (error) {
          if (!(error instanceof DocumentError) || error.status !== 404) throw error;
          entry.state = { status: "preparing", progress: null, error: null };
          const response = await pullOllamaModel(model, deadline, localOllamaUrl("pull"));
          await readInstallProgress(
            response,
            (progress) => {
              entry.state = {
                status: "preparing",
                progress: {
                  percent: progress.percent,
                  completed: progress.completed,
                  total: progress.total,
                },
                error: null,
              };
            },
            deadline,
          );
          // A full progress bar is not proof that the exact local model exists.
          await requireLocalModel(model, deadline);
        }
        entry.state = { status: "ready", progress: null, error: null };
      } catch (error) {
        const message = friendlyPreparationError(error);
        entry.state = { status: "error", progress: null, error: message };
        throw new DocumentError(message, 503);
      }
    })();
    entry.pending = task;
    void task
      .finally(() => {
        entry.pending = undefined;
      })
      .catch(() => {});
  }
  if (!signal) return entry.pending;
  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    entry.pending!.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
