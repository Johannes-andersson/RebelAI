import { z } from "zod";
import {
  canonicalModelTag,
  isSupportedModel,
  ollamaModelTags,
  models,
  installedModelId,
} from "./model-config";
import {
  ModelServiceError,
  modelErrorResponse,
  ollamaConnectionError,
  ollamaUrl,
  resolveModelTag,
} from "./ollama-config.server";
import type { ModelAvailability, ModelInventory } from "./model-manager";

const tagsSchema = z.object({
  models: z.array(
    z.object({ name: z.string().min(1), size: z.number().finite().nonnegative().optional() }),
  ),
});

export async function getModelInventory(signal: AbortSignal): Promise<ModelInventory> {
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
  const configured = Object.keys(ollamaModelTags).map((modelId) => ({
    modelId,
    tag: resolveModelTag(modelId),
  }));
  const tags = new Map(data.data.models.map((m) => [canonicalModelTag(m.name), m]));
  const installedIds = configured.filter((m) => tags.has(m.tag)).map((m) => m.modelId);
  return {
    installed: [...tags.entries()].map(([tag, m]) => {
      const catalog = configured.find((c) => c.tag === tag);
      return {
        id: catalog?.modelId ?? installedModelId(tag),
        tag,
        name: models.find((c) => c.id === catalog?.modelId)?.name ?? tag,
        sizeBytes: m.size ?? null,
      };
    }),
    supported: configured.map((m) => ({ ...m, installed: tags.has(m.tag), installedIds })),
  };
}

export async function getModelAvailability(
  modelId: string,
  signal: AbortSignal,
): Promise<ModelAvailability> {
  resolveModelTag(modelId); // Validate before calling Ollama.
  return (await getModelInventory(signal)).supported.find((m) => m.modelId === modelId)!;
}

export async function handleModelStatus(request: Request): Promise<Response> {
  try {
    const id = new URL(request.url).searchParams.get("modelId");
    return Response.json(
      id === null
        ? await getModelInventory(request.signal)
        : await getModelAvailability(id, request.signal),
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
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

export async function handleModelDelete(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Cross-origin model removal is not allowed." }, { status: 403 });
  if (!request.headers.get("content-type")?.includes("application/json"))
    return Response.json({ error: "Expected a JSON removal request." }, { status: 415 });
  const parsed = z
    .object({ tag: z.string().min(1).max(512) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Choose an installed model to remove." }, { status: 400 });
  try {
    const tag = canonicalModelTag(parsed.data.tag);
    const before = await getModelInventory(request.signal);
    // Never resolve a catalog ID here: delete exactly the tag the user confirmed.
    if (before.installed.some((m) => m.tag === tag)) {
      let response: Response;
      try {
        response = await fetch(ollamaUrl("delete"), {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: tag }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
        });
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new ModelServiceError(
          "Could not confirm model removal. Check Ollama and refresh the model list before retrying.",
        );
      }
      if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => null);
        throw new ModelServiceError(
          `Ollama could not remove the model (${response.status})${typeof body?.error === "string" ? `: ${body.error}` : "."}`,
          502,
        );
      }
    }
    const after = await getModelInventory(request.signal);
    if (after.installed.some((m) => m.tag === tag))
      throw new ModelServiceError("Ollama still lists this model. Refresh and retry removal.", 502);
    return Response.json(after, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return modelErrorResponse(error);
  }
}
