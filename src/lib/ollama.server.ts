import { z } from "zod";

// UI catalog IDs are deliberately separate from provider-specific model tags.
const modelTags = {
  "qwen-7b": "qwen2.5:7b",
  "llama-8b": "llama3.1:8b",
  "gemma-9b": "gemma2:9b",
  "qwen-14b": "qwen2.5:14b",
  "llama-70b": "llama3.1:70b",
} as const;

const chatRequest = z.object({
  modelId: z.enum(["qwen-7b", "llama-8b", "gemma-9b", "qwen-14b", "llama-70b"]),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1) }))
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

  const baseUrl = process.env["OLLAMA_BASE_URL"]?.trim() || "http://127.0.0.1:11434";
  let url: URL;
  try {
    url = new URL(`${baseUrl.replace(/\/+$/, "")}/api/chat`);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid protocol");
  } catch {
    return Response.json(
      { error: "OLLAMA_BASE_URL must be a valid HTTP or HTTPS URL." },
      { status: 500 },
    );
  }

  const { modelId, messages } = parsed.data;
  const envKey = `OLLAMA_MODEL_${modelId.replaceAll("-", "_").toUpperCase()}`;
  const model = process.env[envKey]?.trim() || modelTags[modelId];
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
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
