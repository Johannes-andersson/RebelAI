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
  vi.unstubAllGlobals();
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

const webFixture = {
  title: "Latest release",
  url: "https://example.org/release",
  description: "Version 2 released today.",
};
function setupSearch() {
  db.internet.setEnabled(true);
  vi.stubEnv("WEB_SEARCH_PROVIDER", "brave");
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "test-only-key");
  const search = vi.fn().mockResolvedValue(Response.json({ web: { results: [webFixture] } }));
  vi.stubGlobal("fetch", search);
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response('{"message":{"content":"Version 2 [1]"},"done":true}\n'),
  );
  return search;
}
it("searches fresh questions, streams status, includes untrusted results, and persists sources with one reply", async () => {
  const search = setupSearch();
  const result = await handleConversationChat(
    request(randomUUID(), "What is the latest version of React?"),
    db,
  );
  const text = await result.text();
  expect(text).toContain("Searching the web");
  expect(text).toContain('"done":true');
  expect(search).toHaveBeenCalledOnce();
  const body = await vi.mocked(handleOllamaChat).mock.calls[0]![0].json();
  expect(body.messages[0].content).toContain("UNTRUSTED");
  expect(body.messages[1].role).toBe("user");
  expect(body.messages[1].content).toContain(webFixture.url);
  expect(body.messages.at(-1).content).toBe("What is the latest version of React?");
  expect(JSON.stringify(body)).not.toContain("test-only-key");
  expect(db.get(id).messages).toHaveLength(2);
  expect(db.get(id).messages[1]).toMatchObject({
    content: "Version 2 [1]",
    status: "complete",
    webSearch: { status: "complete", sources: [{ url: webFixture.url }] },
  });
});
it("ignores client permission flags and does not search when the persisted permission is off", async () => {
  const search = setupSearch();
  db.internet.setEnabled(false);
  const base = request(randomUUID(), "Latest AI news");
  const data = await base.json();
  const forged = new Request(base.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...data, internetEnabled: true }),
  });
  await (await handleConversationChat(forged, db)).text();
  expect(search).not.toHaveBeenCalled();
  const body = await vi.mocked(handleOllamaChat).mock.calls[0]![0].json();
  expect(body.messages[0].content).toContain("Internet access is off");
  expect(db.get(id).messages[1]?.webSearch).toMatchObject({ status: "disabled", sources: [] });
});
it("does not search ordinary local questions even when permission is enabled", async () => {
  const search = setupSearch();
  await (
    await handleConversationChat(request(randomUUID(), "Explain Python functions."), db)
  ).text();
  expect(search).not.toHaveBeenCalled();
  expect(db.get(id).messages[1]?.webSearch).toBeUndefined();
});
it("continues locally with a persisted honest notice and no citations when search fails", async () => {
  const search = setupSearch();
  search.mockRejectedValueOnce(new Error("Network offline"));
  await (await handleConversationChat(request(randomUUID(), "Latest AI news"), db)).text();
  expect(db.get(id).messages[1]).toMatchObject({
    status: "complete",
    webSearch: { status: "unavailable", sources: [] },
  });
  const body = await vi.mocked(handleOllamaChat).mock.calls[0]![0].json();
  expect(body.messages[0].content).toContain(
    "rather than presenting old knowledge as verified current",
  );
  expect(JSON.stringify(body)).not.toContain(webFixture.url);
});
it("revoking permission during search aborts the provider, discards results, and continues local chat", async () => {
  const search = setupSearch();
  let providerSignal: AbortSignal | undefined;
  search.mockImplementationOnce(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        providerSignal = options.signal;
        providerSignal!.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        });
      }),
  );
  const response = await handleConversationChat(request(randomUUID(), "Latest AI news"), db);
  await vi.waitFor(() => expect(providerSignal).toBeDefined());
  db.internet.setEnabled(false);
  expect(await response.text()).toContain("Internet access is off");
  expect(providerSignal!.aborted).toBe(true);
  expect(db.get(id).messages[1]).toMatchObject({
    status: "complete",
    webSearch: { status: "disabled", sources: [] },
  });
});
it("cancelling the status stream during a search leaves an interrupted reply and no invented sources", async () => {
  const search = setupSearch();
  search.mockImplementationOnce(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options.signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      ),
  );
  const response = await handleConversationChat(request(randomUUID(), "Latest AI news"), db);
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel();
  expect(db.get(id).messages[1]).toMatchObject({ status: "interrupted", content: "" });
  expect(db.get(id).messages[1]?.webSearch).toBeUndefined();
  expect(handleOllamaChat).not.toHaveBeenCalled();
});
it("keeps web source references scoped to their conversation", async () => {
  setupSearch();
  const first = id;
  await (await handleConversationChat(request(randomUUID(), "Latest AI news"), db)).text();
  id = randomUUID();
  db.create(id, null);
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response('{"message":{"content":"Hello"},"done":true}\n'),
  );
  await (await handleConversationChat(request(), db)).text();
  const body = await vi.mocked(handleOllamaChat).mock.calls[1]![0].json();
  expect(JSON.stringify(body)).not.toContain(webFixture.url);
  expect(db.get(id).messages[1]?.webSearch).toBeUndefined();
  expect(db.get(first).messages[1]?.webSearch?.sources).toHaveLength(1);
});
it("does not send a search query or inference to an unverified remote runtime", async () => {
  const search = setupSearch();
  vi.mocked(requireLocalModel).mockRejectedValueOnce(new Error("Choose a local model"));
  expect(
    await (await handleConversationChat(request(randomUUID(), "Latest AI news"), db)).text(),
  ).toContain("Choose a local model");
  expect(search).not.toHaveBeenCalled();
  expect(handleOllamaChat).not.toHaveBeenCalled();
  expect(db.get(id).messages[1]?.status).toBe("error");
});

async function revisionRequest(
  kind: "regenerate" | "edit",
  userMessageId: string,
  content = "Edited question",
) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId: id,
      messageId: randomUUID(),
      modelId: "qwen-7b",
      content,
      revision: { kind, userMessageId, expectedTailId: db.get(id).messages.at(-1)!.id },
    }),
  });
}
it("regeneration uses the saved prompt, refreshes Brave citations once, and replaces only the assistant", async () => {
  const user = randomUUID();
  const search = setupSearch();
  await (await handleConversationChat(request(user, "Latest React version?"), db)).text();
  search.mockClear();
  search.mockResolvedValue(
    Response.json({ web: { results: [{ ...webFixture, url: "https://example.org/new" }] } }),
  );
  await (
    await handleConversationChat(
      await revisionRequest("regenerate", user, "Do not use this client prompt"),
      db,
    )
  ).text();
  expect(search).toHaveBeenCalledOnce();
  const history = db.get(id);
  expect(history.messages).toHaveLength(2);
  expect(history.messages[0]?.content).toBe("Latest React version?");
  expect(history.messages[1]?.id).not.toBe(`${user}:assistant`);
  expect(history.messages[1]?.webSearch?.sources[0]).toMatchObject({
    id: "S1",
    url: "https://example.org/new",
  });
  const upstream = await vi.mocked(handleOllamaChat).mock.calls.at(-1)![0].json();
  expect(
    upstream.messages.filter(
      (m: { role: string; content: string }) => m.content === "Latest React version?",
    ),
  ).toHaveLength(1);
});
it("editing removes outdated downstream context and respects current internet OFF", async () => {
  const user = randomUUID();
  const search = setupSearch();
  await (await handleConversationChat(request(user, "Latest React version?"), db)).text();
  await (await handleConversationChat(request(randomUUID(), "Explain functions"), db)).text();
  db.internet.setEnabled(false);
  search.mockClear();
  await (
    await handleConversationChat(await revisionRequest("edit", user, "Latest Python version?"), db)
  ).text();
  expect(search).not.toHaveBeenCalled();
  const history = db.get(id);
  expect(history.messages).toHaveLength(2);
  expect(history.messages[0]?.content).toBe("Latest Python version?");
  expect(history.messages[1]?.webSearch?.status).toBe("disabled");
  const upstream = await vi.mocked(handleOllamaChat).mock.calls.at(-1)![0].json();
  expect(JSON.stringify(upstream.messages)).not.toContain("Explain functions");
});
it("failed regeneration leaves one retryable error reply without duplicating the user", async () => {
  const user = randomUUID();
  setupSearch();
  await (await handleConversationChat(request(user, "Explain functions"), db)).text();
  vi.mocked(handleOllamaChat).mockResolvedValue(
    Response.json({ error: "Ollama stopped" }, { status: 503 }),
  );
  const result = await handleConversationChat(await revisionRequest("regenerate", user), db);
  expect(result.status).toBe(503);
  expect(db.get(id).messages).toHaveLength(2);
  expect(db.get(id).messages[1]?.status).toBe("error");
});
it("cancelled regeneration saves partial text as interrupted", async () => {
  const user = randomUUID();
  setupSearch();
  await (await handleConversationChat(request(user, "Explain functions"), db)).text();
  let out!: ReadableStreamDefaultController<Uint8Array>;
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          out = c;
        },
      }),
    ),
  );
  const response = await handleConversationChat(await revisionRequest("regenerate", user), db);
  const reader = response.body!.getReader();
  out.enqueue(encoder.encode('{"message":{"content":"Partial replacement"}}\n'));
  await reader.read();
  await reader.cancel();
  expect(db.get(id).messages).toHaveLength(2);
  expect(db.get(id).messages[1]).toMatchObject({
    content: "Partial replacement",
    status: "interrupted",
  });
});

it.each(["regenerate", "edit"] as const)(
  "%s loads current per-model preferences and preserves Brave context",
  async (kind) => {
    const user = randomUUID();
    setupSearch().mockImplementation(async () => Response.json({ web: { results: [webFixture] } }));
    await (await handleConversationChat(request(user, "Latest React version?"), db)).text();
    const preferences = {
      mode: "custom" as const,
      temperature: 0.25,
      context: 4096,
      maxOutput: 250,
      topP: 0.7,
    };
    db.generation.set("qwen2.5:7b", preferences);
    await (
      await handleConversationChat(await revisionRequest(kind, user, "Latest Python version?"), db)
    ).text();
    const call = vi.mocked(handleOllamaChat).mock.calls.at(-1)!;
    expect(call[1]).toEqual(preferences);
    expect(call[2]).toBe(2);
    expect(db.get(id).messages.at(-1)?.webSearch?.status).toBe("complete");
    expect(db.get(id).messages.at(-1)?.performance?.modelTag).toBe("qwen2.5:7b");
  },
);
it("persists final Ollama measurements with the completed streamed reply", async () => {
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response(
      '{"message":{"content":"Measured answer"},"done":true,"eval_count":20,"eval_duration":1000000000,"total_duration":2000000000}\n',
      {
        headers: {
          "X-Rebel-Generation": encodeURIComponent(
            JSON.stringify({
              options: { num_ctx: 2048, num_predict: 512 },
              estimatedPromptTokens: 100,
              omittedMessages: 2,
            }),
          ),
        },
      },
    ),
  );
  await (await handleConversationChat(request(), db)).text();
  expect(db.get(id).messages[1]?.performance).toMatchObject({
    outputTokens: 20,
    tokensPerSecond: 20,
    runtimeMs: 2000,
    options: { num_ctx: 2048, num_predict: 512 },
    omittedMessages: 2,
  });
  db.close();
  db = new ConversationRepository(join(directory, "db.sqlite"));
  expect(db.get(id).messages[1]?.performance?.tokensPerSecond).toBe(20);
});
it("cancelled replies persist elapsed duration without invented token speed", async () => {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  vi.mocked(handleOllamaChat).mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          out = c;
        },
      }),
    ),
  );
  const response = await handleConversationChat(request(), db);
  const reader = response.body!.getReader();
  out.enqueue(encoder.encode('{"message":{"content":"Partial"}}\n'));
  await reader.read();
  await reader.cancel();
  const message = db.get(id).messages[1]!;
  expect(message.status).toBe("interrupted");
  expect(message.performance?.elapsedMs).toBeGreaterThanOrEqual(0);
  expect(message.performance?.tokensPerSecond).toBeUndefined();
});
