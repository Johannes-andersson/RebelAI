import { z } from "zod";

export interface ModelAvailability {
  modelId: string;
  tag: string;
  installed: boolean;
  installedIds: string[];
}
export interface InstallProgress {
  stage: "manifest" | "download" | "verify" | "ready";
  label: string;
  completed: number;
  total: number;
  percent: number | null;
}

// A future provider implements this interface without changing the setup screens.
export interface ModelManager {
  check(modelId: string, signal?: AbortSignal): Promise<ModelAvailability>;
  install(
    model: ModelAvailability,
    onProgress: (progress: InstallProgress) => void,
    signal: AbortSignal,
  ): Promise<ModelAvailability>;
}

const availabilitySchema = z.object({
  modelId: z.string(),
  tag: z.string(),
  installed: z.boolean(),
  installedIds: z.array(z.string()),
});
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

async function checkResponse(response: Response) {
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

export const modelManager: ModelManager = {
  async check(modelId, signal) {
    const response = await fetch(`/api/models?modelId=${encodeURIComponent(modelId)}`, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
      cache: "no-store",
    }).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      throw new Error(
        "Cannot reach Rebel AI's local server to check Ollama. Make sure the app is running and retry.",
      );
    });
    await checkResponse(response);
    const parsed = availabilitySchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.modelId !== modelId)
      throw new Error("The server returned an invalid model status. Please retry.");
    return parsed.data;
  },

  async install(model, onProgress, signal) {
    signal.throwIfAborted();
    const response = await fetch("/api/models/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: model.modelId, tag: model.tag }),
      signal,
    }).catch((error: unknown) => {
      if (signal.aborted) throw error;
      throw new Error(
        "Could not start the download. Check the local server and Ollama, then retry.",
      );
    });
    await checkResponse(response);
    if (!response.body) throw new Error("Ollama returned no installation progress. Please retry.");
    const reader = response.body.getReader();
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
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    // Success means the exact tag is listed by Ollama, not just a full progress bar.
    signal.throwIfAborted();
    const verified = await modelManager.check(model.modelId, signal);
    signal.throwIfAborted();
    if (!verified.installed || verified.tag !== model.tag)
      throw new Error("The downloaded model could not be verified. Check Ollama and retry.");
    onProgress({ stage: "ready", label: "Ready", completed: 0, total: 0, percent: 100 });
    return verified;
  },
};
