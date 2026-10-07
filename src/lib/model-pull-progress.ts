import { z } from "zod";
import type { InstallProgress } from "./model-manager";
const progressSchema = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
  digest: z.string().optional(),
  completed: z.number().finite().nonnegative().optional(),
  total: z.number().finite().nonnegative().optional(),
});

export function installationError(message: string): string {
  return /no space left|enospc|disk (?:is )?full|not enough (?:disk )?space|insufficient (?:disk|storage)/i.test(
    message,
  )
    ? "Not enough disk space for this model. Free space on the drive used by Ollama, then retry."
    : message;
}

export async function checkResponse(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      installationError(
        typeof body?.error === "string"
          ? body.error
          : `Model request failed (${response.status}). Please retry.`,
      ),
    );
  }
}

export async function readInstallProgress(
  response: Response,
  onProgress: (progress: InstallProgress) => void,
  signal: AbortSignal,
) {
  await checkResponse(response);
  if (!response.body) throw new Error("Ollama returned no installation progress. Please retry.");
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let pending = "";
  let success = false;
  function consume(line: string) {
    if (!line.trim()) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("Ollama returned invalid installation progress. Please retry.");
    }
    const parsed = progressSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error("Ollama returned invalid installation progress. Please retry.");
    const event = parsed.data;
    if (event.error) throw new Error(installationError(`Model download failed: ${event.error}`));
    if (!event.status)
      throw new Error("Ollama returned invalid installation progress. Please retry.");
    if (event.status === "success") {
      success = true;
      onProgress({
        stage: "verify",
        label: "Checking installed model",
        completed: 0,
        total: 0,
        percent: null,
      });
    } else if (event.digest && event.total && event.total > 0) {
      const completed = Math.min(event.total, event.completed ?? 0);
      onProgress({
        stage: "download",
        label: "Downloading model — current file",
        completed,
        total: event.total,
        percent: Math.floor((completed / event.total) * 100),
      });
    } else {
      const verifying = /verif|writing|removing/i.test(event.status);
      onProgress({
        stage: verifying ? "verify" : "manifest",
        label: verifying ? "Verifying and saving model" : "Preparing download",
        completed: 0,
        total: 0,
        percent: null,
      });
    }
  }
  try {
    while (!success) {
      signal.throwIfAborted();
      const { value, done } = await reader.read().catch((error: unknown) => {
        if (signal.aborted) throw error;
        throw new Error("The model download was interrupted. Check your connection and retry.");
      });
      signal.throwIfAborted();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        consume(line);
        if (success) break;
      }
      if (done) {
        if (!success) consume(pending);
        break;
      }
    }
    if (!success) throw new Error("The model download ended before completion. Please retry.");
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
