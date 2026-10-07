import { access } from "node:fs/promises";
import { platform } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ollamaConnectionError, ollamaUrl, resolveModelTag } from "./ollama-config.server";
vi.mock("node:fs/promises", () => { const mock = { access: vi.fn() }; return { ...mock, default: mock }; });
vi.mock("node:os", () => { const mock = { platform: vi.fn(), homedir: () => "/Users/test" }; return { ...mock, default: mock }; });
beforeEach(() => {
  vi.stubEnv("OLLAMA_BASE_URL", "");
  vi.stubEnv("PATH", "");
  vi.mocked(platform).mockReturnValue("darwin");
  vi.mocked(access).mockRejectedValue(new Error("ENOENT"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe("Ollama configuration and availability diagnostics", () => {
  it("shares configurable tags and adds implicit latest", () => {
    expect(resolveModelTag("qwen-7b")).toBe("qwen2.5:7b");
    vi.stubEnv("OLLAMA_MODEL_QWEN_7B", "custom/model");
    expect(resolveModelTag("qwen-7b")).toBe("custom/model:latest");
    expect(() => resolveModelTag("toString")).toThrow("supported model");
  });
  it("validates the configured server URL", () => {
    vi.stubEnv("OLLAMA_BASE_URL", "https://example.test/ollama/");
    expect(ollamaUrl("pull").href).toBe("https://example.test/ollama/api/pull");
    vi.stubEnv("OLLAMA_BASE_URL", "file:///tmp");
    expect(() => ollamaUrl("tags")).toThrow("HTTP or HTTPS");
  });
  it("detects a stopped macOS app without executing commands", async () => {
    vi.mocked(access).mockImplementation(async (path) => {
      if (path !== "/Applications/Ollama.app/Contents/Resources/ollama") throw new Error();
    });
    expect((await ollamaConnectionError()).code).toBe("ollama_not_running");
  });
  it("distinguishes a missing installation while acknowledging custom paths", async () => {
    const error = await ollamaConnectionError();
    expect(error.code).toBe("ollama_not_found");
    expect(error.message).toContain("If installed elsewhere");
  });
  it("checks the standard Windows user installation", async () => {
    vi.mocked(platform).mockReturnValue("win32");
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\test\\AppData\\Local");
    const exe = "C:\\Users\\test\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
    vi.mocked(access).mockImplementation(async (path) => {
      if (path !== exe) throw new Error();
    });
    expect((await ollamaConnectionError()).code).toBe("ollama_not_running");
    expect(access).toHaveBeenCalledWith(exe, expect.any(Number));
  });
  it("checks a quoted Windows PATH with spaces", async () => {
    vi.mocked(platform).mockReturnValue("win32");
    vi.stubEnv("PATH", 'C:\\Other;"C:\\Program Files\\Ollama"');
    vi.mocked(access).mockImplementation(async (path) => {
      if (path !== "C:\\Program Files\\Ollama\\ollama.exe") throw new Error();
    });
    expect((await ollamaConnectionError()).code).toBe("ollama_not_running");
  });
  it("does not infer remote installation from the local filesystem", async () => {
    vi.stubEnv("OLLAMA_BASE_URL", "http://other-computer:11434");
    expect((await ollamaConnectionError()).message).toContain("configured Ollama server");
    expect(access).not.toHaveBeenCalled();
  });
});
