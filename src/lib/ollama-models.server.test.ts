import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getModelAvailability,
  handleModelPull,
  handleModelStatus,
  handleModelDelete,
  getModelInventory,
} from "./ollama-models.server";
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

function deletion(tag = "qwen2.5:7b", origin = "http://localhost") {
  return new Request("http://localhost/api/models", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify({ tag }),
  });
}
describe("real model inventory and removal", () => {
  it("lists actual sizes and models outside the catalog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          models: [
            { name: "qwen2.5:7b", size: 123 },
            { name: "my/custom", size: 456 },
          ],
        }),
      ),
    );
    const data = await getModelInventory(signal());
    expect(data.installed).toEqual([
      { id: "qwen-7b", tag: "qwen2.5:7b", name: "Qwen 7B", sizeBytes: 123 },
      {
        id: "ollama:my/custom:latest",
        tag: "my/custom:latest",
        name: "my/custom:latest",
        sizeBytes: 456,
      },
    ]);
    expect(data.supported.find((m) => m.modelId === "qwen-7b")?.installed).toBe(true);
  });
  it("returns inventory from GET without a modelId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => Response.json({ models: [] })),
    );
    const res = await handleModelStatus(new Request("http://localhost/api/models"));
    expect(res.status).toBe(200);
    expect((await res.json()).installed).toEqual([]);
  });
  it("deletes the confirmed exact tag and verifies the remaining inventory", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ models: [{ name: "my/custom:latest", size: 123 }] }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(Response.json({ models: [] }));
    vi.stubGlobal("fetch", fetcher);
    const res = await handleModelDelete(deletion("my/custom:latest"));
    expect(res.status).toBe(200);
    expect((await res.json()).installed).toEqual([]);
    expect(String(fetcher.mock.calls[1]![0])).toBe("http://127.0.0.1:11434/api/delete");
    expect(fetcher.mock.calls[1]![1]).toMatchObject({
      method: "DELETE",
      body: JSON.stringify({ model: "my/custom:latest" }),
    });
  });
  it("does not delete a different tag after an environment override changes", async () => {
    vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "qwen2.5:14b");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () =>
          Response.json({ models: [{ name: "qwen2.5:14b", size: 123 }] }),
        ),
    );
    const res = await handleModelDelete(deletion());
    expect(res.status).toBe(200);
    expect(vi.mocked(fetch).mock.calls.every((c) => c[1]?.method !== "DELETE")).toBe(true);
    expect((await res.json()).installed[0].tag).toBe("qwen2.5:14b");
  });
  it("handles already removed models without a destructive call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => Response.json({ models: [] })),
    );
    expect((await handleModelDelete(deletion())).status).toBe(200);
    expect(vi.mocked(fetch).mock.calls.every((c) => c[1]?.method !== "DELETE")).toBe(true);
  });
  it("does not claim success if Ollama still lists the model", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ models: [{ name: "qwen2.5:7b" }] }))
        .mockResolvedValueOnce(new Response(null))
        .mockResolvedValueOnce(Response.json({ models: [{ name: "qwen2.5:7b" }] })),
    );
    expect((await handleModelDelete(deletion())).status).toBe(502);
  });
  it("preserves delete errors without inventing an updated list", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ models: [{ name: "qwen2.5:7b" }] }))
        .mockResolvedValueOnce(Response.json({ error: "permission denied" }, { status: 500 })),
    );
    const res = await handleModelDelete(deletion());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("permission denied");
  });
  it("rejects cross-origin or non-JSON deletion", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await handleModelDelete(deletion("qwen2.5:7b", "https://other.test"))).status).toBe(
      403,
    );
    expect(
      (
        await handleModelDelete(
          new Request("http://localhost/api/models", { method: "DELETE", body: "text" }),
        )
      ).status,
    ).toBe(415);
    expect(fetch).not.toHaveBeenCalled();
  });
});
