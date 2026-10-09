import { ollamaMetrics } from "./generation-config";
import { webSearchSchema } from "./web-search";
// Shared decoding for the local chat stream. Neither screen knows Ollama's wire format.
export async function* readChatStream(body: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let hasText = false;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read().catch((error: unknown) => {
        if (signal?.aborted) throw error;
        throw new Error("The response was interrupted. Please try again.");
      });
      signal?.throwIfAborted();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      if (done && pending.trim()) lines.push(pending);
      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          throw new Error("Invalid streaming response. Please try again.");
        }
        if (!event || typeof event !== "object")
          throw new Error("Invalid streaming response. Please try again.");
        if (typeof event.error === "string") throw new Error(event.error);
        const search = webSearchSchema.safeParse(event.webSearch);
        const text = typeof event.message?.content === "string" ? event.message.content : "";
        hasText ||= !!text;
        if (event.done === true && !hasText)
          throw new Error("Ollama returned no reply. Please try again.");
        yield {
          text,
          metrics: ollamaMetrics(event),
          done: event.done === true,
          webSearch: search.success ? search.data : undefined,
        };
        if (event.done === true) return;
      }
      if (done) throw new Error("The response was interrupted. Please try again.");
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
