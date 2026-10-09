import { afterEach, describe, expect, it, vi } from "vitest";
import { chatRuntime } from "./runtime";

const request = {
  modelId: "qwen-7b",
  conversationId: "conversation",
  messageId: "message",
  content: "Hello",
};
const encoder = new TextEncoder();

function streamResponse(parts: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  );
}

function mockReply(text: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([encoder.encode(text)])));
}

afterEach(() => vi.unstubAllGlobals());

describe("chat runtime", () => {
  it("decodes split JSON, split UTF-8, multiple records, and a final line without newline", async () => {
    const bytes = encoder.encode(
      '\n{"message":{"content":"Hé"},"done":false}\r\n' +
        '{"message":{"content":"llo"},"done":false}\n{"done":true}',
    );
    // One byte per chunk guarantees JSON and multibyte characters cross boundaries.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(streamResponse(Array.from(bytes, (b) => new Uint8Array([b])))),
    );
    const chunks: string[] = [];
    await chatRuntime.streamReply(request, (chunk) => chunks.push(chunk));
    expect(chunks).toEqual(["Hé", "llo"]);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual(request);
  });

  it("delivers text before the response ends", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
            },
          }),
        ),
      ),
    );
    let received!: () => void;
    const firstChunk = new Promise<void>((resolve) => {
      received = resolve;
    });
    const onToken = vi.fn(received);
    const result = chatRuntime.streamReply(request, onToken);
    stream.enqueue(encoder.encode('{"message":{"content":"Hello"},"done":false}\n'));
    await firstChunk;
    expect(onToken).toHaveBeenCalledWith("Hello");
    stream.enqueue(encoder.encode('{"done":true}\n'));
    stream.close();
    await result;
  });

  it.each([
    ['{"message":{"content":"Partial"}}\n', "interrupted"],
    ['{"error":"model crashed"}\n', "model crashed"],
    ["not json\n", "Invalid streaming response"],
    ["null\n", "Invalid streaming response"],
    ['{"done":true}\n', "no reply"],
  ])("rejects a bad stream: %s", async (text, message) => {
    mockReply(text);
    await expect(chatRuntime.streamReply(request, vi.fn())).rejects.toThrow(message);
  });

  it("preserves actionable server errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ error: "Cannot connect to Ollama." }, { status: 503 })),
    );
    await expect(chatRuntime.streamReply(request, vi.fn())).rejects.toThrow(
      "Cannot connect to Ollama",
    );
  });

  it("explains an unreachable app server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(chatRuntime.streamReply(request, vi.fn())).rejects.toThrow("local server");
  });

  it("passes cancellation to fetch and emits no tokens after abort", async () => {
    mockReply('{"message":{"content":"Hello"},"done":true}\n');
    const controller = new AbortController();
    controller.abort();
    const onToken = vi.fn();
    await expect(
      chatRuntime.streamReply(request, onToken, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal).toBe(controller.signal);
    expect(onToken).not.toHaveBeenCalled();
  });
});

it("delivers validated search status separately from reply tokens", async () => {
  const webSearch = { status: "searching", notice: "Searching the web…", sources: [] };
  mockReply(
    JSON.stringify({ webSearch }) +
      "\n" +
      JSON.stringify({ message: { content: "Answer" }, done: true }) +
      "\n",
  );
  const status = vi.fn(),
    tokens = vi.fn();
  await chatRuntime.streamReply(request, tokens, undefined, status);
  expect(status).toHaveBeenCalledWith(webSearch);
  expect(tokens).toHaveBeenCalledExactlyOnceWith("Answer");
});
