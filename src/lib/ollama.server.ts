import { embeddingModel } from "./embedding-config.server";
import { z } from "zod";
import { getModelInventory } from "./ollama-models.server";
import { isSupportedModel } from "./model-config";
import {
  ollamaUrl,
  resolveModelTag,
  modelErrorResponse,
  ModelServiceError,
} from "./ollama-config.server";

const chatRequest = z.object({
  modelId: z
    .string()
    .max(512)
    .refine((id) => isSupportedModel(id) || id.startsWith("ollama:")),
  messages: z
    .array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().min(1) }))
    .min(1),
});

export async function handleOllamaChat(request: Request): Promise<Response> {
  // This endpoint is for the local app; don't allow other sites to drive Ollama.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin chat requests are not allowed." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected a JSON chat request." }, { status: 415 });
  }
  const parsed = chatRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Choose a supported model and send a non-empty message." },
      { status: 400 },
    );
  }

  let url: URL;
  try {
    url = ollamaUrl("chat");
  } catch (error) {
    return modelErrorResponse(error);
  }

  const { modelId, messages } = parsed.data;
  const envKey = `OLLAMA_MODEL_${modelId.replaceAll("-", "_").toUpperCase()}`;
  let model: string;
  try {
    model = await resolveChatModelTag(modelId, request.signal);
  } catch (error) {
    return modelErrorResponse(error);
  }
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return Response.json(
      {
        error:
          "Cannot connect to Ollama. Open the Ollama app or run `ollama serve`, then try again. If it is already running, check OLLAMA_BASE_URL.",
      },
      { status: 503 },
    );
  }

  if (!upstream.ok) {
    const body = await upstream.json().catch(() => null);
    const error =
      upstream.status === 404
        ? `Ollama model "${model}" is not installed. Run \`ollama pull ${model}\` or configure ${envKey} to match an installed model.`
        : `Ollama could not generate a reply (${upstream.status})${typeof body?.error === "string" ? `: ${body.error}` : "."}`;
    return Response.json({ error }, { status: upstream.status === 404 ? 404 : 502 });
  }
  if (!upstream.body) {
    return Response.json({ error: "Ollama returned an empty response." }, { status: 502 });
  }

  // Forward the stream directly; buffering the whole response would break streaming.
  return new Response(upstream.body, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}

export async function resolveChatModelTag(modelId: string, signal: AbortSignal): Promise<string> {
  if (isSupportedModel(modelId)) {
    const tag = resolveModelTag(modelId);
    if (tag === embeddingModel())
      throw new ModelServiceError("Choose a conversational model for chat.", 400);
    return tag;
  }
  const installed = (await getModelInventory(signal)).installed.find((m) => m.id === modelId);
  if (!installed)
    throw new ModelServiceError(
      "This model is no longer installed. Refresh Models and select another model.",
      404,
    );
  return installed.tag;
}
