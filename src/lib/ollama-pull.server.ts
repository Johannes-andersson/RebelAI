import { ollamaUrl, ModelServiceError } from "./ollama-config.server";

// Shared transport for user-selected models and internal local components.
export async function pullOllamaModel(
  tag: string,
  signal: AbortSignal,
  url = ollamaUrl("pull"),
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  // Bound the wait for response headers, not the model download itself.
  const headerTimeout = setTimeout(abort, 30000);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: tag, stream: true }),
      signal: controller.signal,
    });
  } catch (error) {
    signal.removeEventListener("abort", abort);
    if (signal.aborted) throw error;
    throw new ModelServiceError(
      "Ollama did not start the download. Check that it is running and retry.",
      503,
    );
  } finally {
    clearTimeout(headerTimeout);
  }
  if (!upstream.ok || !upstream.body) {
    signal.removeEventListener("abort", abort);
    const error = await upstream.json().catch(() => null);
    throw new ModelServiceError(
      typeof error?.error === "string"
        ? error.error
        : `Model download failed (${upstream.status}).`,
      502,
      "download_failed",
    );
  }

  const reader = upstream.body.getReader();
  const cleanup = () => signal.removeEventListener("abort", abort);
  // Explicitly propagate downstream cancellation to Ollama, including when the
  // HTTP server cancels the response body rather than aborting Request.signal.
  const stream = new ReadableStream<Uint8Array>({
    async pull(out) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          cleanup();
          reader.releaseLock();
          out.close();
        } else out.enqueue(value);
      } catch (error) {
        cleanup();
        out.error(error);
      }
    },
    async cancel() {
      cleanup();
      controller.abort();
      await reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
