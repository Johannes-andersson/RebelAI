import type { ChatMessage } from "./types";

export interface ChatRequest {
  modelId: string;
  messages: Pick<ChatMessage, "role" | "content">[];
}

// The UI depends only on this interface. Another provider can implement it later.
export interface ChatRuntime {
  streamReply(
    request: ChatRequest,
    onToken: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

// Ollama's wire format stays inside this adapter, never in the chat component.
export const chatRuntime: ChatRuntime = {
  async streamReply(request, onToken, signal) {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: signal ?? null,
    }).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      throw new Error("Cannot reach Rebel AI's local server. Check that the app is running.");
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        typeof body?.error === "string" ? body.error : `Chat request failed (${response.status}).`,
      );
    }
    if (!response.body) throw new Error("The chat server returned an empty response.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let finished = false;
    let hasText = false;

    function consume(line: string) {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new Error("Ollama returned an invalid streaming response. Please try again.");
      }
      if (!event || typeof event !== "object") {
        throw new Error("Ollama returned an invalid streaming response. Please try again.");
      }
      if (typeof event.error === "string") throw new Error(`Ollama: ${event.error}`);
      if (typeof event.message?.content === "string" && event.message.content) {
        hasText = true;
        onToken(event.message.content);
      }
      if (event.done === true) finished = true;
    }

    try {
      while (!finished) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read().catch((error: unknown) => {
          if (signal?.aborted) throw error;
          throw new Error("Ollama's response was interrupted. Please try again.");
        });
        signal?.throwIfAborted();
        pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          consume(line);
          if (finished) break;
        }
        if (done) {
          if (!finished) consume(pending);
          break;
        }
      }
      if (!finished) throw new Error("Ollama's response was interrupted. Please try again.");
      if (!hasText) throw new Error("Ollama returned no reply. Please try again.");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },
};
