import { internetSchema } from "./web-search";
async function request(enabled?: boolean, signal?: AbortSignal) {
  const response = await fetch("/api/internet", {
    method: enabled === undefined ? "GET" : "PATCH",
    cache: "no-store",
    signal: signal ?? null,
    ...(enabled === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) }),
  }).catch(() => {
    throw new Error("Cannot reach Rebel AI to update internet permission. Please retry.");
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not update internet permission.",
    );
  const parsed = internetSchema.safeParse(data);
  if (!parsed.success) throw new Error("Could not read internet permission. Please retry.");
  return parsed.data;
}
export const internet = {
  get: (signal?: AbortSignal) => request(undefined, signal),
  set: (enabled: boolean) => request(enabled),
};
