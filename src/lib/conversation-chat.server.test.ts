// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { ConversationRepository } from "./conversations.server";
import { handleConversationChat } from "./conversation-chat.server";
import { handleOllamaChat } from "./ollama.server";
vi.mock("./ollama.server", () => ({ handleOllamaChat: vi.fn() }));
let db: ConversationRepository;
let id: string;
const encoder = new TextEncoder();
const request = (messageId = randomUUID(), content = "Hello", signal?: AbortSignal) =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: signal ?? null,
    body: JSON.stringify({ conversationId: id, messageId, modelId: "qwen-7b", content }),
  });
beforeEach(() => {
  db = new ConversationRepository(":memory:");
  id = randomUUID();
  db.create(id, null);
  vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "");
});
afterEach(() => {
  db.close();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

describe("durable streamed conversations", () => {
  it("saves the prompt first, checkpoints tokens, and commits before reporting completion", async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(handleOllamaChat).mockImplementation(async () => {
      expect(db.get(id).messages.map((m) => m.status)).toEqual(["complete", "pending"]);
      return new Response(
        new ReadableStream({
          start(out) {
            upstream = out;
          },
        }),
      );
    });
    const response = await handleConversationChat(request(), db);
    const reader = response.body!.getReader();
    upstream.enqueue(encoder.encode('{"message":{"content":"First "},"done":false}\n'));
    await reader.read();
    expect(db.get(id).messages[1]).toMatchObject({ content: "First ", status: "pending" });
    upstream.enqueue(encoder.encode('{"message":{"content":"answer"},"done":true}\n'));
    upstream.close();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"done":true');
    expect(db.get(id).messages[1]).toMatchObject({ content: "First answer", status: "complete" });
    await reader.read();
  });
  it("preserves partial text when the browser cancels", async () => {
    let upstream!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    vi.mocked(handleOllamaChat).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(out) {
            upstream = out;
          },
          cancel,
        }),
      ),
    );
    const response = await handleConversationChat(request(), db);
    const reader = response.body!.getReader();
    upstream.enqueue(encoder.encode('{"message":{"content":"Partial"}}\n'));
    await reader.read();
    await reader.cancel();
    expect(db.get(id).messages[1]).toMatchObject({ content: "Partial", status: "interrupted" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
  it("records service failures and excludes incomplete replies from later context", async () => {
    vi.mocked(handleOllamaChat)
      .mockResolvedValueOnce(new Response('{"message":{"content":"Partial"}}\n'))
      .mockResolvedValueOnce(new Response('{"message":{"content":"Final"},"done":true}\n'));
    const first = await handleConversationChat(request(), db);
    expect(await first.text()).toContain("interrupted");
    expect(db.get(id).messages[1]?.status).toBe("error");
    const second = await handleConversationChat(request(randomUUID(), "Follow up"), db);
    await second.text();
    const body = await vi.mocked(handleOllamaChat).mock.calls[1]![0].json();
    expect(body.messages).toEqual([
      { role: "user", content: "Hello" },
      { role: "user", content: "Follow up" },
    ]);
    expect(db.get(id).messages[3]?.content).toBe("Final");
  });
  it("saves a user prompt even when Ollama is unavailable", async () => {
    vi.mocked(handleOllamaChat).mockResolvedValue(
      Response.json({ error: "Ollama offline" }, { status: 503 }),
    );
    expect((await handleConversationChat(request(), db)).status).toBe(503);
    expect(db.get(id).messages).toMatchObject([
      { content: "Hello" },
      { status: "error", content: "" },
    ]);
  });
  it("does not emit a successful completion when the final database write fails", async () => {
    vi.mocked(handleOllamaChat).mockResolvedValue(
      new Response('{"message":{"content":"Final"},"done":true}\n'),
    );
    const save = db.saveReply.bind(db);
    vi.spyOn(db, "saveReply").mockImplementation((...args) => {
      if (args[2] === "complete") throw new Error("disk full");
      save(...args);
    });
    const response = await handleConversationChat(request(), db);
    const text = await response.text();
    expect(text).not.toContain('"done":true');
    expect(text).toContain('"error"');
    expect(db.get(id).messages[1]?.status).toBe("error");
  });
  it("keeps another conversation out of the provider context", async () => {
    const other = randomUUID(),
      msg = randomUUID();
    db.create(other, null);
    db.beginTurn(other, msg, "Private to other chat", "qwen2.5:7b");
    db.saveReply(`${msg}:assistant`, "Other answer", "complete");
    vi.mocked(handleOllamaChat).mockResolvedValue(
      new Response('{"message":{"content":"Only here"},"done":true}\n'),
    );
    await (await handleConversationChat(request(), db)).text();
    expect((await vi.mocked(handleOllamaChat).mock.calls[0]![0].json()).messages).toEqual([
      { role: "user", content: "Hello" },
    ]);
    expect(db.get(other).messages[1]?.content).toBe("Other answer");
  });
});
