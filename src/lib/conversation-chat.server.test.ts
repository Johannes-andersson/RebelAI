// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processDocument } from "./document-processing.server";
import { requireLocalModel } from "./embeddings.server";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { ConversationRepository } from "./conversations.server";
import { handleConversationChat } from "./conversation-chat.server";
import { handleOllamaChat } from "./ollama.server";
vi.mock("./ollama.server", () => ({ handleOllamaChat: vi.fn() }));
vi.mock("./embeddings.server", () => ({
  localEmbedder: () => ({
    model: "test:local",
    embed: async (texts: string[]) => texts.map(() => [1, 0]),
  }),
  requireLocalModel: vi.fn(async () => {}),
}));
let directory: string;
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
  directory = mkdtempSync(join(tmpdir(), "rebel-rag-stream-"));
  db = new ConversationRepository(join(directory, "db.sqlite"));
  id = randomUUID();
  db.create(id, null);
  vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "");
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
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

it("streams with scoped document context and durable source excerpts", async () => {
  const file = db.documents.create(
    id,
    "launch.txt",
    new TextEncoder().encode("Launch code: ORCHID"),
  );
  await processDocument(db.documents, id, file.id);
  vi.mocked(handleOllamaChat).mockImplementation(async (request) => {
    const body = await request.json();
    expect(body.messages[0]).toMatchObject({
      role: "system",
      content: expect.stringContaining("Launch code: ORCHID"),
    });
    expect(body.messages[1]).toEqual({ role: "user", content: "What is the launch code?" });
    expect(db.get(id).messages[1]!.sources).toMatchObject([{ filename: "launch.txt" }]);
    return new Response('{"message":{"content":"ORCHID"},"done":true}\n');
  });
  const result = await handleConversationChat(
    request(randomUUID(), "What is the launch code?"),
    db,
  );
  expect(await result.text()).toContain('"done":true');
  expect(requireLocalModel).toHaveBeenCalledWith("qwen2.5:7b", expect.any(AbortSignal));
  expect(db.get(id).messages[1]).toMatchObject({
    content: "ORCHID",
    status: "complete",
    sources: [{ fileId: file.id, text: "Launch code: ORCHID" }],
  });
});
it("does not call embeddings or change normal chat context without attachments", async () => {
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response('{"message":{"content":"Hi"},"done":true}\n'),
  );
  await (await handleConversationChat(request(), db)).text();
  expect(requireLocalModel).not.toHaveBeenCalled();
  expect((await vi.mocked(handleOllamaChat).mock.calls[0]![0].json()).messages).toEqual([
    { role: "user", content: "Hello" },
  ]);
});

it("acknowledges explicit memory only after durable storage and uses it in a separate conversation", async () => {
  const first = await handleConversationChat(
    request(randomUUID(), "Remember that Rebel AI is my main project."),
    db,
  );
  expect(await first.text()).toContain("I’ll remember");
  expect(handleOllamaChat).not.toHaveBeenCalled();
  expect(db.memories.list()[0]?.content).toBe("Rebel AI is my main project.");
  const original = id;
  id = randomUUID();
  db.create(id, null);
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response('{"message":{"content":"Rebel AI"},"done":true}\n'),
  );
  await (await handleConversationChat(request(randomUUID(), "What is my project?"), db)).text();
  const body = await vi.mocked(handleOllamaChat).mock.calls[0]![0].json();
  expect(body.messages).toHaveLength(2);
  expect(body.messages[0].content).toContain("Relevant saved user memories");
  expect(body.messages[1]).toEqual({ role: "user", content: "What is my project?" });
  expect(db.get(id).messages[1]).toMatchObject({ content: "Rebel AI", memoryUsed: true });
  expect(db.get(original).messages).toHaveLength(2);
});
it("keeps memory and file contexts distinct while preserving streaming", async () => {
  db.memories.create("Use short answers", id);
  const file = db.documents.create(id, "code.txt", new TextEncoder().encode("Code: ORCHID"));
  await processDocument(db.documents, id, file.id);
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response('{"message":{"content":"ORCHID"},"done":true}\n'),
  );
  await (await handleConversationChat(request(randomUUID(), "What is the code?"), db)).text();
  const body = await vi.mocked(handleOllamaChat).mock.calls[0]![0].json();
  expect(body.messages).toHaveLength(3);
  expect(body.messages[0].content).toContain("saved user memories");
  expect(body.messages[0].content).not.toContain("ORCHID");
  expect(body.messages[1].content).toContain("ORCHID");
  expect(body.messages[1].content).not.toContain("Use short answers");
});
it.each(["disabled", "database failure", "embedding failure"])(
  "continues ordinary streamed chat with %s",
  async (mode) => {
    db.memories.create("Remembered fact", id);
    if (mode === "disabled") db.memories.setEnabled(false);
    if (mode === "database failure")
      vi.spyOn(db, "memories", "get").mockImplementation(() => {
        throw new Error("memory unavailable");
      });
    if (mode === "embedding failure")
      vi.mocked(requireLocalModel).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(handleOllamaChat).mockResolvedValue(
      new Response('{"message":{"content":"Hello"},"done":true}\n'),
    );
    expect(await (await handleConversationChat(request(), db)).text()).toContain('"done":true');
    expect((await vi.mocked(handleOllamaChat).mock.calls[0]![0].json()).messages).toEqual([
      { role: "user", content: "Hello" },
    ]);
    expect(db.get(id).messages[1]).toMatchObject({ content: "Hello", memoryUsed: false });
    vi.restoreAllMocks();
  },
);
it("does not save an explicit instruction while memory is disabled", async () => {
  db.memories.setEnabled(false);
  expect(
    await (
      await handleConversationChat(request(randomUUID(), "Remember this: private fact"), db)
    ).text(),
  ).toContain("turned off");
  expect(db.memories.list()).toEqual([]);
  expect(handleOllamaChat).not.toHaveBeenCalled();
});
