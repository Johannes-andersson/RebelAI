import { z } from "zod";
import { canonicalModelTag, isSupportedModel, ollamaModelTags } from "./model-config";
import {
  ModelServiceError,
  modelErrorResponse,
  ollamaConnectionError,
  ollamaUrl,
  resolveModelTag,
} from "./ollama-config.server";
import type { ModelAvailability } from "./model-manager";

const tagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

export async function getModelAvailability(
  modelId: string,
  signal: AbortSignal,
): Promise<ModelAvailability> {
  const tag = resolveModelTag(modelId);
  let response: Response;
  const url = ollamaUrl("tags");
  try {
    response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
  } catch (error) {
    if (signal.aborted) throw error;
    throw await ollamaConnectionError();
  }
  if (!response.ok)
    throw new ModelServiceError(
      `Ollama could not list installed models (${response.status}).`,
      502,
    );
  const data = tagsSchema.safeParse(await response.json().catch(() => null));
  if (!data.success)
    throw new ModelServiceError(
      "Ollama returned an invalid model list. Check OLLAMA_BASE_URL.",
      502,
    );
  const tags = new Set(data.data.models.map((m) => canonicalModelTag(m.name)));
  return {
    modelId,
    tag,
    installed: tags.has(tag),
    installedIds: Object.keys(ollamaModelTags).filter((id) => tags.has(resolveModelTag(id))),
  };
}

export async function handleModelStatus(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).searchParams.get("modelId") || "";
    return Response.json(await getModelAvailability(id, request.signal), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return modelErrorResponse(error);
  }
}

export async function handleModelPull(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json(
      { error: "Cross-origin model installation is not allowed." },
      { status: 403 },
    );
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "Expected a JSON installation request." }, { status: 415 });
  }
  const parsed = z
    .object({ modelId: z.string().refine(isSupportedModel), tag: z.string().min(1) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Choose a supported model before installing." }, { status: 400 });

  try {
    const { modelId, tag } = parsed.data;
    if (tag !== resolveModelTag(modelId)) {
      throw new ModelServiceError(
        "The model configuration changed. Go back and check the recommendation again.",
        409,
        "configuration",
      );
    }
    // Confirm connectivity before a potentially long pull. Pulling an existing tag is
    // safe: Ollama reuses its cached layers and reports their real progress.
    await getModelAvailability(modelId, request.signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    // Bound the wait for response headers, not the model download itself.
    const headerTimeout = setTimeout(abort, 30000);
    let upstream: Response;
    try {
      upstream = await fetch(ollamaUrl("pull"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: tag, stream: true }),
        signal: controller.signal,
      });
    } catch (error) {
      request.signal.removeEventListener("abort", abort);
      if (request.signal.aborted) throw error;
      throw new ModelServiceError(
        "Ollama did not start the download. Check that it is running and retry.",
        503,
      );
    } finally {
      clearTimeout(headerTimeout);
    }
    if (!upstream.ok || !upstream.body) {
      request.signal.removeEventListener("abort", abort);
      const error = await upstream.json().catch(() => null);
      throw new ModelServiceError(
        typeof error?.error === "string"
          ? error.error
          : `Model download failed (${upstream.status}).`,
        502,
        "download_failed",
      );
    }

    const reader = upstream.body.getReader();
    const cleanup = () => request.signal.removeEventListener("abort", abort);
    // Explicitly propagate downstream cancellation to Ollama, including when the
    // HTTP server cancels the response body rather than aborting Request.signal.
    const stream = new ReadableStream<Uint8Array>({
      async pull(out) {
        try {
          const { value, done } = await reader.read();
          if (done) {
            cleanup();
            reader.releaseLock();
            out.close();
          } else out.enqueue(value);
        } catch (error) {
          cleanup();
          out.error(error);
        }
      },
      async cancel() {
        cleanup();
        controller.abort();
        await reader.cancel().catch(() => {});
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
