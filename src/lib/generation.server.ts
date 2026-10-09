import { freemem } from "node:os";
import { z } from "zod";
import { detectSystemInfo } from "./system-info.server";
import { getModelInventory } from "./ollama-models.server";
import { canonicalModelTag } from "./model-config";
import { ollamaUrl, ModelServiceError, modelErrorResponse } from "./ollama-config.server";
import { checkLocalConversationRequest } from "./conversation-api.server";
import { getConversations, type ConversationRepository } from "./conversations.server";
import {
  preferencesSchema,
  contextRecommendation,
  effectiveOptions,
  fitPrompt,
  type GenerationPreferences,
  type GenerationProfile,
  type PromptMessage,
} from "./generation-config";

async function ollamaJson(path: string, signal: AbortSignal, body?: unknown) {
  try {
    const response = await fetch(ollamaUrl(path), {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
      ...(body
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
    if (!response.ok) throw new Error();
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (signal.aborted) throw error;
    throw new ModelServiceError(
      "Could not inspect this model in Ollama. Make sure Ollama is running and the model is installed, then refresh.",
    );
  }
}
export async function generationProfile(
  tag: string,
  preferences: GenerationPreferences,
  signal: AbortSignal,
): Promise<GenerationProfile> {
  const installed = (await getModelInventory(signal)).installed.find(
    (m) => m.tag === canonicalModelTag(tag),
  );
  if (!installed)
    throw new ModelServiceError(
      "This model is no longer installed. Select another installed model. Its saved preferences have been kept.",
      404,
    );
  const show = await ollamaJson("show", signal, { model: installed.tag });
  if (show["remote_model"] || show["remote_host"])
    throw new ModelServiceError("Choose a local model for these controls.", 400);
  const capabilities = z.array(z.string()).safeParse(show["capabilities"]);
  if (capabilities.success && !capabilities.data.includes("completion"))
    throw new ModelServiceError(
      "This model does not report support for conversational generation.",
      400,
    );
  const info = show["model_info"];
  const architecture =
    info && typeof info === "object" ? Reflect.get(info, "general.architecture") : undefined;
  const context =
    info && typeof info === "object" && typeof architecture === "string"
      ? Reflect.get(info, `${architecture}.context_length`)
      : undefined;
  const modelContext =
    typeof context === "number" && Number.isSafeInteger(context) && context > 0 ? context : null;
  let totalBytes: number | null = null,
    freeBytes: number | null = null;
  try {
    totalBytes = (await detectSystemInfo()).memoryBytes;
    freeBytes = freemem();
  } catch {
    /* Conservative unknown-hardware fallback. */
  }
  const recommendation = contextRecommendation(totalBytes, installed.sizeBytes, modelContext);
  let options: GenerationProfile["options"] = null;
  let warning: string | null = null;
  try {
    options = effectiveOptions(preferences, recommendation.limit, recommendation.recommended);
  } catch (error) {
    warning = error instanceof Error ? error.message : "Review this model's settings.";
  }
  if (
    !warning &&
    freeBytes !== null &&
    installed.sizeBytes !== null &&
    installed.sizeBytes * 1.25 > freeBytes
  )
    warning =
      "Estimated weight memory exceeds currently free RAM. A loaded model or reclaimable caches may already occupy that memory; larger context increases pressure. Close other apps if needed.";
  if (!capabilities.success || modelContext === null)
    warning = [
      warning,
      "Some model limits could not be verified; conservative context limits apply. Runtime support ultimately depends on Ollama and the model.",
    ]
      .filter(Boolean)
      .join(" ");
  return {
    tag: installed.tag,
    sizeBytes: installed.sizeBytes,
    preferences,
    ...recommendation,
    modelContext,
    totalBytes,
    freeBytes,
    warning,
    options,
  };
}
export async function prepareGeneration(
  tag: string,
  preferences: GenerationPreferences,
  messages: PromptMessage[],
  prefixCount: number,
  signal: AbortSignal,
) {
  const profile = await generationProfile(tag, preferences, signal);
  try {
    const options = effectiveOptions(preferences, profile.limit, profile.recommended);
    return { ...fitPrompt(messages, prefixCount, options), options };
  } catch (error) {
    throw new ModelServiceError(
      error instanceof Error ? error.message : "Review Model Settings.",
      400,
      "generation_settings",
    );
  }
}
export async function handleGenerationSettings(
  request: Request,
  repository?: ConversationRepository,
) {
  try {
    checkLocalConversationRequest(request);
    const tag = z
      .string()
      .trim()
      .min(1)
      .max(512)
      .parse(new URL(request.url).searchParams.get("tag"));
    const db = (repository ?? getConversations()).generation;
    if (request.method !== "GET" && request.method !== "PATCH")
      throw new ModelServiceError("Method not allowed.", 405);
    let preferences = db.get(tag);
    if (request.method === "PATCH") {
      const body = preferencesSchema.safeParse(await request.json().catch(() => null));
      if (!body.success)
        throw new ModelServiceError(
          "Invalid model settings. Check the displayed ranges and try again.",
          400,
        );
      preferences = body.data;
    }
    const profile = await generationProfile(tag, preferences, request.signal);
    if (request.method === "PATCH") {
      try {
        effectiveOptions(preferences, profile.limit, profile.recommended);
      } catch (error) {
        throw new ModelServiceError(
          error instanceof Error ? error.message : "Invalid settings.",
          400,
        );
      }
      profile.preferences = db.set(tag, preferences);
    }
    try {
      const ps = await ollamaJson("ps", request.signal);
      const parsed = z
        .object({
          models: z.array(
            z.object({
              name: z.string(),
              size: z.number().finite().nonnegative().optional(),
              context_length: z.number().int().positive().optional(),
            }),
          ),
        })
        .parse(ps);
      const loaded = parsed.models.find((m) => canonicalModelTag(m.name) === profile.tag);
      profile.loaded = loaded
        ? { sizeBytes: loaded.size ?? null, context: loaded.context_length ?? null }
        : null;
      profile.loadedNotice = loaded
        ? "Loaded in Ollama at this check (snapshot)."
        : "Not currently loaded in Ollama at this check.";
    } catch {
      profile.loadedNotice = "Loaded-model status could not be verified.";
    }
    request.signal.throwIfAborted();
    return Response.json(profile, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json({ error: "Choose a valid model tag." }, { status: 400 });
    if (error instanceof Error && "status" in error && typeof error.status === "number")
      return Response.json({ error: error.message }, { status: error.status });
    return modelErrorResponse(error);
  }
}
