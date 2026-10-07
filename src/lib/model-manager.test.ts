import { afterEach, describe, expect, it, vi } from "vitest";
import { modelManager, type InstallProgress } from "./model-manager";

const model = { modelId: "qwen-7b", tag: "qwen2.5:7b", installed: false, installedIds: [] };
const installed = { ...model, installed: true, installedIds: [model.modelId] };
const controller = () => new AbortController();
function stream(events: unknown[]) {
  const bytes = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n"));
  return new Response(
    new ReadableStream({
      start(out) {
        // Split every byte, including multi-byte UTF-8 sequences and JSON records.
        for (const byte of bytes) out.enqueue(new Uint8Array([byte]));
        out.close();
      },
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("model manager", () => {
  it("parses split progress, handles new layers, then verifies the exact tag", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        stream([
          { status: "pulling manifest — 开始" },
          { status: "pulling abc", digest: "abc", total: 100 },
          { status: "pulling abc", digest: "abc", total: 100, completed: 50 },
          { status: "pulling def", digest: "def", total: 10, completed: 10 },
          { status: "verifying sha256 digest" },
          { status: "success" },
        ]),
      )
      .mockResolvedValueOnce(Response.json(installed));
    vi.stubGlobal("fetch", fetcher);
    const progress: InstallProgress[] = [];
    expect(await modelManager.install(model, (p) => progress.push(p), controller().signal)).toEqual(
      installed,
    );
    expect(progress.map((p) => p.percent)).toEqual([null, 0, 50, 100, null, null, 100]);
    expect(progress.at(-1)?.stage).toBe("ready");
    expect(fetcher.mock.calls[0]![1].body).toBe(
      JSON.stringify({ modelId: model.modelId, tag: model.tag }),
    );
    expect(fetcher.mock.calls[1]![0]).toBe("/api/models?modelId=qwen-7b");
  });

  it.each([
    [[{ status: "pulling manifest" }], /ended before completion/],
    [[{ completed: -1, status: "pulling" }], /invalid installation progress/],
    [[{ error: "network unreachable" }], /download failed: network unreachable/],
    [[{ error: "write: no space left on device" }], /Not enough disk space/],
    [[{ error: "There is not enough space on the disk" }], /Not enough disk space/],
  ])("rejects incomplete or failed downloads %#", async (events, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stream(events)));
    await expect(modelManager.install(model, vi.fn(), controller().signal)).rejects.toThrow(
      message,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows HTTP failures including disk errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "ENOSPC" }, { status: 502 })),
    );
    await expect(modelManager.install(model, vi.fn(), controller().signal)).rejects.toThrow(
      "Not enough disk space",
    );
  });

  it.each([model, { ...installed, tag: "qwen2.5:14b" }])(
    "does not finish when verification disagrees",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(stream([{ status: "success" }]))
          .mockResolvedValueOnce(Response.json(status)),
      );
      const progress = vi.fn();
      await expect(modelManager.install(model, progress, controller().signal)).rejects.toThrow(
        "could not be verified",
      );
      expect(progress).not.toHaveBeenCalledWith(expect.objectContaining({ stage: "ready" }));
    },
  );

  it("does not verify or finish after cancellation", async () => {
    const abort = controller();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(stream([{ status: "pulling manifest" }, { status: "success" }])),
    );
    await expect(modelManager.install(model, () => abort.abort(), abort.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains useful server availability errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: "Ollama is installed but is not responding" }, { status: 503 }),
        ),
    );
    await expect(modelManager.check(model.modelId)).rejects.toThrow("not responding");
  });

  it("rejects status for the wrong model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ ...installed, modelId: "qwen-14b" })),
    );
    await expect(modelManager.check(model.modelId)).rejects.toThrow("invalid model status");
  });
});

it("lists real inventory through the provider interface", async () => {
  const inventory = {
    installed: [
      { id: "ollama:custom:latest", tag: "custom:latest", name: "custom:latest", sizeBytes: 456 },
    ],
    supported: [],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(inventory)));
  expect(await modelManager.list()).toEqual(inventory);
});
it("sends the confirmed tag for deletion and returns verified inventory", async () => {
  const inventory = { installed: [], supported: [] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(inventory)));
  expect(await modelManager.remove("my/custom:latest")).toEqual(inventory);
  expect(fetch).toHaveBeenCalledWith(
    "/api/models",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ tag: "my/custom:latest" }),
    }),
  );
});
it("reports deletion failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: "Ollama could not remove the model" }, { status: 502 }),
      ),
  );
  await expect(modelManager.remove("custom:latest")).rejects.toThrow("could not remove");
});
it("rejects malformed inventory rather than fabricating installed state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ installed: [{ sizeBytes: -1 }], supported: [] })),
  );
  await expect(modelManager.list()).rejects.toThrow("invalid model inventory");
});
