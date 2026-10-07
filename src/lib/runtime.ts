import { readChatStream } from "./chat-stream";
export interface ChatRequest {
  modelId: string;
  conversationId: string;
  messageId: string;
  content: string;
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

    for await (const event of readChatStream(response.body, signal)) {
      if (event.text) onToken(event.text);
    }
  },
};
