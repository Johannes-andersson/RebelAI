import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getModelAvailability, handleModelPull, handleModelStatus } from "./ollama-models.server";
import { ModelServiceError, ollamaConnectionError } from "./ollama-config.server";
vi.mock("./ollama-config.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ollama-config.server")>()),
  ollamaConnectionError: vi.fn(),
}));
const signal = () => new AbortController().signal;
function request(
  body: unknown = { modelId: "qwen-7b", tag: "qwen2.5:7b" },
  origin = "http://localhost",
) {
  return new Request("http://localhost/api/models/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("OLLAMA_BASE_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Ollama model server", () => {
  it("matches exact tags rather than model families", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ models: [{ name: "qwen2.5:14b" }, { name: "llama3.1:8b" }] }),
        ),
    );
    expect(await getModelAvailability("qwen-7b", signal())).toEqual({
      modelId: "qwen-7b",
      tag: "qwen2.5:7b",
      installed: false,
      installedIds: ["llama-8b", "qwen-14b"],
    });
  });
  it("uses configured tags and normalizes implicit latest", async () => {
    vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "custom");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ models: [{ name: "custom:latest" }] })),
    );
    expect(await getModelAvailability("qwen-7b", signal())).toMatchObject({
      tag: "custom:latest",
      installed: true,
    });
  });
  it("returns actionable connection diagnostics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED")));
    vi.mocked(ollamaConnectionError).mockResolvedValue(
      new ModelServiceError("Open the Ollama app", 503, "ollama_not_running"),
    );
    const response = await handleModelStatus(
      new Request("http://localhost/api/models?modelId=qwen-7b"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "ollama_not_running" });
  });
  it("rejects arbitrary model names and changed configuration before contacting Ollama", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await handleModelPull(request({ modelId: "unlisted", tag: "anything" }))).status).toBe(
      400,
    );
    expect(
      (await handleModelPull(request({ modelId: "qwen-7b", tag: "qwen2.5:14b" }))).status,
    ).toBe(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects cross-origin pulls and non-JSON submissions", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await handleModelPull(request(undefined, "https://other.test"))).status).toBe(403);
    expect(
      (
        await handleModelPull(
          new Request("http://localhost/api/models/pull", { method: "POST", body: "text" }),
        )
      ).status,
    ).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("forwards real progress immediately and cancels the upstream request", async () => {
    const cancelled = vi.fn();
    const first = new TextEncoder().encode('{"status":"pulling manifest"}\n');
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ models: [] }))
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(out) {
              out.enqueue(first);
            },
            cancel: cancelled,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const response = await handleModelPull(request());
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(first);
    const [url, options] = fetcher.mock.calls[1]!;
    expect(url.href).toBe("http://127.0.0.1:11434/api/pull");
    expect(JSON.parse(options.body)).toEqual({ model: "qwen2.5:7b", stream: true });
    await reader.cancel();
    expect(options.signal.aborted).toBe(true);
    expect(cancelled).toHaveBeenCalled();
  });
  it("preserves disk-space errors from failed pulls", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ models: [] }))
        .mockResolvedValueOnce(
          Response.json({ error: "no space left on device" }, { status: 500 }),
        ),
    );
    const response = await handleModelPull(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: "no space left on device",
      code: "download_failed",
    });
  });
  it("rejects invalid model lists without starting a pull", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ garbage: true })));
    const response = await handleModelPull(request());
    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
