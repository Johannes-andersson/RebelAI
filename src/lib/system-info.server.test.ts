import { beforeEach, describe, expect, it, vi } from "vitest";
import { cpus, machine, platform, totalmem } from "node:os";
import { detectSystemInfo, handleSystemInfo } from "./system-info.server";

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("node:os", () => {
  const os = { cpus: vi.fn(), machine: vi.fn(), platform: vi.fn(), totalmem: vi.fn() };
  return { ...os, default: os };
});
vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  default: { execFile: execFileMock },
}));

function cpu(model: string) {
  return { model, speed: 0, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(platform).mockReturnValue("darwin");
  vi.mocked(machine).mockReturnValue("arm64");
  vi.mocked(cpus).mockReturnValue([cpu("Apple M4 Pro")]);
  vi.mocked(totalmem).mockReturnValue(48 * 2 ** 30);
  execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "1\n"));
});

describe("local system detection", () => {
  it("returns real OS inputs and a recommendation without identifying information", async () => {
    const response = await handleSystemInfo();
    expect(response.headers.get("cache-control")).toBe("no-store");
    const info = await response.json();
    expect(info).toMatchObject({
      os: "macOS",
      chip: "Apple M4 Pro",
      architecture: "ARM64",
      platform: "Apple Silicon",
      memoryBytes: 48 * 2 ** 30,
      memoryGB: 48,
      acceleration: "Not checked",
      recommendation: { tier: "Large", modelId: "qwen-14b" },
    });
    expect(Object.keys(info).sort()).toEqual([
      "acceleration",
      "architecture",
      "chip",
      "memoryBytes",
      "memoryGB",
      "os",
      "platform",
      "recommendation",
    ]);
    expect(execFileMock).toHaveBeenCalledWith(
      "/usr/sbin/sysctl",
      ["-n", "hw.optional.arm64"],
      { timeout: 1500, maxBuffer: 1024, encoding: "utf8" },
      expect.any(Function),
    );
  });

  it("reports the physical ARM64 architecture when Node runs under Rosetta", async () => {
    vi.mocked(machine).mockReturnValue("x86_64");
    expect((await detectSystemInfo()).architecture).toBe("ARM64");
  });

  it("handles Intel Macs when the optional sysctl key is unavailable or times out", async () => {
    vi.mocked(machine).mockReturnValue("x86_64");
    vi.mocked(cpus).mockReturnValue([cpu("Intel Core i7")]);
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error("timeout"), ""),
    );
    expect(await detectSystemInfo()).toMatchObject({
      chip: "Intel Core i7",
      architecture: "x64",
      platform: "Intel Mac",
    });
  });

  it("retains Apple Silicon detection if the optional query fails", async () => {
    vi.mocked(machine).mockReturnValue("x86_64");
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(new Error("unavailable"), ""),
    );
    expect(await detectSystemInfo()).toMatchObject({
      architecture: "ARM64",
      platform: "Apple Silicon",
    });
  });

  it.each([
    ["linux", "Linux"],
    ["win32", "Windows"],
  ] as const)("uses OS APIs on %s without running macOS commands", async (os, name) => {
    vi.mocked(platform).mockReturnValue(os);
    vi.mocked(machine).mockReturnValue("x86_64");
    vi.mocked(cpus).mockReturnValue([cpu("AMD Ryzen 7")]);
    expect(await detectSystemInfo()).toMatchObject({
      os: name,
      chip: "AMD Ryzen 7",
      architecture: "x64",
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("shows Unknown CPU rather than inventing a chip", async () => {
    vi.mocked(cpus).mockReturnValue([]);
    expect((await detectSystemInfo()).chip).toBe("Unknown CPU");
  });

  it("returns a clear failure if total memory is unavailable", async () => {
    vi.mocked(totalmem).mockReturnValue(0);
    const response = await handleSystemInfo();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("local Node server");
  });
});
