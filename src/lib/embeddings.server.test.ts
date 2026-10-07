// @vitest-environment node
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  embeddingModel,
  localEmbedder,
  requireLocalModel,
  prepareDocumentSearch,
  documentSearchStatus,
} from "./embeddings.server";
const fetchMock = vi.fn();
let installed: boolean;
let pulls: number;
let showCalls: number;
const progress = () =>
  new Response(
    '{"status":"pulling manifest"}\n{"status":"pulling layer","digest":"abc","completed":50,"total":100}\n{"status":"success"}\n',
  );
beforeEach(() => {
  installed = true;
  pulls = 0;
  showCalls = 0;
  vi.stubGlobal("fetch", fetchMock);
  // Separate manager state for each test without relying on a cached readiness flag.
  vi.stubEnv("OLLAMA_BASE_URL", `http://127.0.0.1:11434/${crypto.randomUUID()}`);
  vi.stubEnv("OLLAMA_EMBEDDING_MODEL", "embeddinggemma:300m");
  fetchMock.mockImplementation(async (url: URL, options: RequestInit) => {
    if (url.pathname.endsWith("/show")) {
      showCalls++;
      return installed
        ? Response.json({ capabilities: ["embedding"] })
        : Response.json({ error: "missing" }, { status: 404 });
    }
    if (url.pathname.endsWith("/pull")) {
      pulls++;
      installed = true;
      return progress();
    }
    if (url.pathname.endsWith("/embed")) {
      const body = JSON.parse(String(options.body));
      return Response.json({ embeddings: body.input.map(() => [1, 0]) });
    }
    throw new Error("Unexpected request");
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it("uses the centrally configured local model without downloading when installed", async () => {
  expect(embeddingModel()).toBe("embeddinggemma:300m");
  expect(await localEmbedder().embed(["one", "two"])).toEqual([
    [1, 0],
    [1, 0],
  ]);
  expect(pulls).toBe(0);
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
    model: "embeddinggemma:300m",
    input: ["one", "two"],
    truncate: false,
  });
  expect(fetchMock.mock.calls[1]![1].redirect).toBe("error");
});
it("automatically pulls a missing component then embeds without a manual retry", async () => {
  installed = false;
  expect(await localEmbedder().embed(["private"])).toEqual([[1, 0]]);
  expect(pulls).toBe(1);
  expect(showCalls).toBe(2);
  expect(documentSearchStatus()).toMatchObject({ status: "ready", error: null });
  expect(
    JSON.parse(fetchMock.mock.calls.find(([url]) => url.pathname.endsWith("/pull"))![1].body),
  ).toEqual({ model: "embeddinggemma:300m", stream: true });
});
it("shares a pull across concurrent callers and exposes real layer progress", async () => {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  installed = false;
  fetchMock.mockImplementation(async (url: URL) => {
    if (url.pathname.endsWith("/show"))
      return installed ? Response.json({}) : Response.json({}, { status: 404 });
    pulls++;
    return new Response(
      new ReadableStream({
        start(controller) {
          out = controller;
        },
      }),
    );
  });
  const first = prepareDocumentSearch(),
    second = prepareDocumentSearch();
  await vi.waitFor(() => expect(pulls).toBe(1));
  out.enqueue(
    new TextEncoder().encode(
      '{"status":"pulling layer","digest":"abc","completed":25,"total":100}\n',
    ),
  );
  await vi.waitFor(() =>
    expect(documentSearchStatus()).toMatchObject({
      status: "preparing",
      progress: { percent: 25, completed: 25, total: 100 },
    }),
  );
  installed = true;
  out.enqueue(new TextEncoder().encode('{"status":"success"}\n'));
  out.close();
  await Promise.all([first, second]);
  expect(documentSearchStatus().status).toBe("ready");
});
it("rechecks and reinstalls after external removal", async () => {
  await localEmbedder().embed(["first"]);
  installed = false;
  await localEmbedder().embed(["next question"]);
  expect(pulls).toBe(1);
  expect(documentSearchStatus().status).toBe("ready");
});
it("reports friendly download failures and can retry successfully", async () => {
  installed = false;
  fetchMock
    .mockImplementationOnce(async () => Response.json({}, { status: 404 }))
    .mockImplementationOnce(
      async () => new Response('{"error":"connection failed: ollama pull technical command"}\n'),
    );
  await expect(prepareDocumentSearch()).rejects.toThrow("could not be installed");
  expect(documentSearchStatus().error).not.toMatch(/ollama pull|embeddinggemma/);
  await prepareDocumentSearch();
  expect(documentSearchStatus().status).toBe("ready");
});
it("translates disk-full failures without exposing raw instructions", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({}, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ error: "no space left on device" }, { status: 500 }));
  await expect(prepareDocumentSearch()).rejects.toThrow("not enough disk space");
});
it("does not claim ready if success is reported but the component is still missing", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({}, { status: 404 }))
    .mockResolvedValueOnce(progress())
    .mockResolvedValueOnce(Response.json({}, { status: 404 }));
  await expect(prepareDocumentSearch()).rejects.toThrow("could not be installed");
  expect(documentSearchStatus().status).toBe("error");
});
it("rejects remote endpoints and cloud proxies before sending document text or pulling", async () => {
  vi.stubEnv("OLLAMA_BASE_URL", "https://example.com");
  await expect(localEmbedder().embed(["private"])).rejects.toThrow("this computer");
  expect(fetchMock).not.toHaveBeenCalled();
  vi.stubEnv("OLLAMA_BASE_URL", "http://127.0.0.1:11434");
  fetchMock.mockResolvedValue(
    Response.json({ remote_host: "https://ollama.com", remote_model: "cloud" }),
  );
  await expect(localEmbedder().embed(["private"])).rejects.toThrow("cloud model");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("keeps missing chat-model errors command-free and rejects malformed embeddings", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({}, { status: 404 }));
  await expect(requireLocalModel("missing-chat-model")).rejects.toThrow("unavailable");
  fetchMock
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json({ embeddings: [[0, 0]] }));
  await expect(localEmbedder().embed(["text"])).rejects.toThrow("invalid results");
});
it("cancelling one waiter does not interrupt another file's installation", async () => {
  installed = false;
  let finish!: () => void;
  fetchMock
    .mockImplementationOnce(async () => Response.json({}, { status: 404 }))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => {
            installed = true;
            resolve(progress());
          };
        }),
    );
  const controller = new AbortController();
  const first = prepareDocumentSearch(controller.signal);
  const second = prepareDocumentSearch();
  const cancelled = expect(first).rejects.toThrow();
  await vi.waitFor(() => expect(finish).toBeDefined());
  controller.abort();
  await cancelled;
  finish();
  await second;
  expect(documentSearchStatus().status).toBe("ready");
});
it("does not start work for a cancelled caller or on status reads", async () => {
  expect(documentSearchStatus().status).toBe("idle");
  const controller = new AbortController();
  controller.abort();
  await expect(prepareDocumentSearch(controller.signal)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
