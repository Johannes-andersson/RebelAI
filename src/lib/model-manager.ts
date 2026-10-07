import { checkResponse, readInstallProgress } from "./model-pull-progress";
import { z } from "zod";

export interface ModelAvailability {
  modelId: string;
  tag: string;
  installed: boolean;
  installedIds: string[];
}
export interface InstalledModel {
  id: string;
  tag: string;
  name: string;
  sizeBytes: number | null;
}
export interface ModelInventory {
  installed: InstalledModel[];
  supported: ModelAvailability[];
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
  list(signal?: AbortSignal): Promise<ModelInventory>;
  remove(tag: string, signal?: AbortSignal): Promise<ModelInventory>;
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
const inventorySchema = z.object({
  installed: z.array(
    z.object({
      id: z.string(),
      tag: z.string(),
      name: z.string(),
      sizeBytes: z.number().finite().nonnegative().nullable(),
    }),
  ),
  supported: z.array(availabilitySchema),
});
async function readInventory(response: Response): Promise<ModelInventory> {
  await checkResponse(response);
  const parsed = inventorySchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new Error("The server returned an invalid model inventory. Please refresh.");
  return parsed.data;
}
async function inventoryRequest(method: "GET" | "DELETE", signal?: AbortSignal, tag?: string) {
  const response = await fetch("/api/models", {
    method,
    cache: "no-store",
    signal: AbortSignal.any([
      ...(signal ? [signal] : []),
      AbortSignal.timeout(method === "DELETE" ? 45000 : 8000),
    ]),
    ...(tag
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag }) }
      : {}),
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new Error(
      method === "DELETE"
        ? "Could not confirm removal. Refresh the model list before retrying."
        : "Cannot reach Rebel AI's local server. Make sure the app is running and refresh.",
    );
  });
  return readInventory(response);
}

export const modelManager: ModelManager = {
  list: (signal) => inventoryRequest("GET", signal),
  remove: (tag, signal) => inventoryRequest("DELETE", signal, tag),
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
    await readInstallProgress(response, onProgress, signal);
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
