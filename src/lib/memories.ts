import { memoryStateSchema } from "./memory-config";
async function request(path = "", method = "GET", body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/memories${path}`, {
    method,
    cache: "no-store",
    signal: signal ?? null,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new Error("Cannot reach local memory storage. Check that Rebel AI is running and retry.");
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not update saved memories.",
    );
  const parsed = memoryStateSchema.safeParse(data);
  if (!parsed.success) throw new Error("Could not read saved memories. Please retry.");
  return parsed.data;
}
export const memories = {
  list: (signal?: AbortSignal) => request("", "GET", undefined, signal),
  setEnabled: (enabled: boolean) => request("", "PATCH", { enabled }),
  remove: (id: string) => request(`/${encodeURIComponent(id)}`, "DELETE"),
  clear: () => request("?confirm=clear", "DELETE"),
};
