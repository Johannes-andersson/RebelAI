import { cpus, machine, platform, totalmem } from "node:os";
import { execFile } from "node:child_process";
import { recommendHardware } from "./hardware-recommendation";
import type { SystemInfo } from "./types";

function isAppleSilicon(): Promise<boolean> {
  return new Promise((resolve) => {
    // Fixed executable and arguments, read-only, no shell and no elevated privileges.
    execFile(
      "/usr/sbin/sysctl",
      ["-n", "hw.optional.arm64"],
      { timeout: 1500, maxBuffer: 1024, encoding: "utf8" },
      (error, stdout) => resolve(!error && stdout.trim() === "1"),
    );
  });
}

export async function detectSystemInfo(): Promise<SystemInfo> {
  const osPlatform = platform();
  if (!["darwin", "linux", "win32"].includes(osPlatform)) {
    throw new Error("Hardware detection requires a local macOS, Linux, or Windows server.");
  }
  const chip =
    cpus()
      .find((cpu) => cpu.model.trim())
      ?.model.trim() || "Unknown CPU";
  let architecture = machine();
  // uname can report x86_64 under Rosetta. Check the physical Mac capability.
  if (osPlatform === "darwin" && (await isAppleSilicon())) architecture = "arm64";
  const appleSilicon =
    osPlatform === "darwin" && (architecture === "arm64" || /^Apple\s+M\d/i.test(chip));
  if (appleSilicon) architecture = "arm64";
  const memoryBytes = totalmem();

  return {
    chip,
    memoryBytes,
    // Preserve raw bytes for thresholds; round only the display value.
    memoryGB: Math.round((memoryBytes / 2 ** 30) * 10) / 10,
    platform: appleSilicon ? "Apple Silicon" : osPlatform === "darwin" ? "Intel Mac" : "PC",
    os: osPlatform === "darwin" ? "macOS" : osPlatform === "win32" ? "Windows" : "Linux",
    architecture:
      architecture === "arm64" || architecture === "aarch64"
        ? "ARM64"
        : architecture === "x86_64" || architecture === "x64"
          ? "x64"
          : architecture || "Unknown",
    acceleration: "Not checked",
    recommendation: recommendHardware(memoryBytes),
  };
}

export async function handleSystemInfo(): Promise<Response> {
  try {
    return Response.json(await detectSystemInfo(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      {
        error:
          "Could not detect this computer's hardware. Make sure Rebel AI is running as a local Node server, then try again.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
