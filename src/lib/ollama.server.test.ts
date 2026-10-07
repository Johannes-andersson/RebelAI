import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleOllamaChat } from "./ollama.server";

const payload = {
  modelId: "qwen-7b",
  messages: [
    { role: "user", content: "My name is Sam." },
    { role: "assistant", content: "Hello Sam!" },
    { role: "user", content: "What is my name?" },
  ],
};
function request(body: unknown = payload, headers = {}) {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("OLLAMA_BASE_URL", "");
  vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Ollama server adapter", () => {
  it("maps the selected model, sends history, and forwards the stream without buffering", async () => {
    const upstream = new ReadableStream<Uint8Array>();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(upstream)));
    const incoming = request();
    const response = await handleOllamaChat(incoming);
    expect(response.body).toBe(upstream);
    expect(response.headers.get("content-type")).toBe("application/x-ndjson");
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(options!.body as string)).toEqual({
      model: "qwen2.5:7b",
      messages: payload.messages,
      stream: true,
    });
    expect(options!.signal).toBe(incoming.signal);
    await response.body!.cancel();
  });

  it("uses configured base URL and model tag", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://localhost:12345/");
    vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "qwen2.5:7b-custom");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}\n")));
    await handleOllamaChat(request());
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://localhost:12345/api/chat");
    expect(JSON.parse(options!.body as string).model).toBe("qwen2.5:7b-custom");
  });

  it("returns actionable instructions when Ollama is offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED")));
    const response = await handleOllamaChat(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("ollama serve");
  });

  it("explains a missing model", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "model not found" }, { status: 404 })),
    );
    const response = await handleOllamaChat(request());
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("ollama pull qwen2.5:7b");
  });

  it("preserves other Ollama errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "not enough memory" }, { status: 500 })),
    );
    const response = await handleOllamaChat(request());
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("not enough memory");
  });

  it.each([
    { ...payload, modelId: "unknown" },
    { ...payload, messages: [] },
    { ...payload, messages: [{ role: "user", content: "" }] },
    { ...payload, messages: [{ role: "system", content: "bad" }] },
  ])("rejects invalid requests before calling Ollama", async (body) => {
    vi.stubGlobal("fetch", vi.fn());
    expect((await handleOllamaChat(request(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects requests from other origins", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(
      (await handleOllamaChat(request(payload, { Origin: "https://another-site.example" }))).status,
    ).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid base URLs with a configuration error", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "not-a-url");
    const response = await handleOllamaChat(request());
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("OLLAMA_BASE_URL");
  });
});
