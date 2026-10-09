// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  generationProfile,
  prepareGeneration,
  handleGenerationSettings,
} from "./generation.server";
import { handleOllamaChat } from "./ollama.server";
import { detectSystemInfo } from "./system-info.server";
import { ConversationRepository } from "./conversations.server";
vi.mock("./system-info.server", () => ({ detectSystemInfo: vi.fn() }));
const signal = () => new AbortController().signal;
const show = {
  capabilities: ["completion"],
  model_info: { "general.architecture": "qwen2", "qwen2.context_length": 32768 },
};
let db: ConversationRepository;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  db = new ConversationRepository(":memory:");
  vi.mocked(detectSystemInfo).mockResolvedValue({ memoryBytes: 16 * 2 ** 30 } as Awaited<
    ReturnType<typeof detectSystemInfo>
  >);
  vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:11434");
  vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "qwen2.5:7b");
  fetcher = vi.fn(async (url: URL) => {
    if (url.pathname === "/api/tags")
      return Response.json({ models: [{ name: "qwen2.5:7b", size: 4 * 2 ** 30 }] });
    if (url.pathname === "/api/show") return Response.json(show);
    if (url.pathname === "/api/ps")
      return Response.json({
        models: [{ name: "qwen2.5:7b", size: 5 * 2 ** 30, context_length: 4096 }],
      });
    if (url.pathname === "/api/chat")
      return new Response(
        '{"message":{"content":"Hello"},"done":true,"eval_count":1,"eval_duration":100000000}\n',
      );
    throw new Error("Unexpected external request");
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});
function request(method = "GET", body?: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/model-settings?tag=qwen2.5%3A7b", {
    method,
    headers: { "Content-Type": "application/json", origin },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("sends all four custom options to real adapter construction and forwards streaming", async () => {
  const response = await handleOllamaChat(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "qwen-7b", messages: [{ role: "user", content: "Hi" }] }),
    }),
    { mode: "custom", temperature: 0.2, context: 4096, maxOutput: 200, topP: 0.7 },
  );
  expect(await response.text()).toContain('"done":true');
  const call = fetcher.mock.calls.find((args) => String(args[0]).endsWith("/chat"))!;
  expect(JSON.parse((call as unknown as [URL, RequestInit])[1].body as string).options).toEqual({
    temperature: 0.2,
    num_ctx: 4096,
    num_predict: 200,
    top_p: 0.7,
  });
});
it("saves only validated preferences and reports measured loaded status", async () => {
  const result = await handleGenerationSettings(
    request("PATCH", { mode: "custom", temperature: 0.3 }),
    db,
  );
  expect(result.status).toBe(200);
  const data = await result.json();
  expect(data.loaded.context).toBe(4096);
  expect(data.loadedNotice).toContain("snapshot");
  expect(db.generation.get("qwen2.5:7b").temperature).toBe(0.3);
  expect(
    (await handleGenerationSettings(request("PATCH", { mode: "custom", context: 32768 }), db))
      .status,
  ).toBe(400);
  expect(db.generation.get("qwen2.5:7b").temperature).toBe(0.3);
  expect(
    (await handleGenerationSettings(request("PATCH", { mode: "custom", topP: 3 }), db)).status,
  ).toBe(400);
  expect((await handleGenerationSettings(request("PATCH", { mode: "automatic" }), db)).status).toBe(
    200,
  );
  expect(db.generation.get("qwen2.5:7b")).toEqual({ mode: "automatic" });
});
it("rejects cross-site settings writes before reaching Ollama", async () => {
  expect(
    (
      await handleGenerationSettings(
        request("PATCH", { mode: "automatic" }, "https://evil.example"),
        db,
      )
    ).status,
  ).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps removed-model preferences and returns a clear missing-model error", async () => {
  db.generation.set("qwen2.5:7b", { mode: "custom", topP: 0.4 });
  fetcher.mockResolvedValueOnce(Response.json({ models: [] }));
  const response = await handleGenerationSettings(request(), db);
  expect(response.status).toBe(404);
  expect(db.generation.get("qwen2.5:7b").topP).toBe(0.4);
});
it("rejects non-chat and cloud-backed models rather than assuming option support", async () => {
  fetcher.mockImplementation(async (url: URL) =>
    url.pathname.endsWith("/tags")
      ? Response.json({ models: [{ name: "qwen2.5:7b" }] })
      : Response.json({ capabilities: ["embedding"] }),
  );
  await expect(generationProfile("qwen2.5:7b", { mode: "automatic" }, signal())).rejects.toThrow(
    "conversational",
  );
  fetcher.mockImplementation(async (url: URL) =>
    url.pathname.endsWith("/tags")
      ? Response.json({ models: [{ name: "qwen2.5:7b" }] })
      : Response.json({ ...show, remote_model: "cloud" }),
  );
  await expect(generationProfile("qwen2.5:7b", { mode: "automatic" }, signal())).rejects.toThrow(
    "local model",
  );
});
it("uses conservative unknown hardware defaults and does not fabricate loaded metrics", async () => {
  vi.mocked(detectSystemInfo).mockRejectedValue(new Error("unavailable"));
  const profile = await generationProfile("qwen2.5:7b", { mode: "automatic" }, signal());
  expect(profile.options?.num_ctx).toBe(2048);
  expect(profile.totalBytes).toBeNull();
  expect(profile.loaded).toBeUndefined();
});
it("counts supporting web context against the prompt budget and preserves caller cancellation", async () => {
  await expect(
    prepareGeneration(
      "qwen2.5:7b",
      { mode: "custom", context: 512 },
      [
        { role: "system", content: "Search snippets: " + "x".repeat(2000) },
        { role: "user", content: "Question" },
      ],
      1,
      signal(),
    ),
  ).rejects.toThrow("supporting context");
  const abort = new AbortController();
  abort.abort();
  fetcher.mockImplementation(async (_url: URL, options: RequestInit) => {
    options.signal?.throwIfAborted();
    throw new Error();
  });
  await expect(
    generationProfile("qwen2.5:7b", { mode: "automatic" }, abort.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
