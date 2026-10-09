import { profileSchema, type GenerationPreferences } from "./generation-config";
export async function modelSettings(
  tag: string,
  preferences?: GenerationPreferences,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/model-settings?tag=${encodeURIComponent(tag)}`, {
    method: preferences ? "PATCH" : "GET",
    cache: "no-store",
    signal: signal ?? null,
    ...(preferences
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(preferences) }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data?.error === "string" ? data.error : "Could not load or save Model Settings.",
    );
  return profileSchema.parse(data);
}
