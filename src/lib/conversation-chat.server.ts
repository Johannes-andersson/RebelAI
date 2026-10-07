import { retrieveDocuments, documentContext } from "./retrieval.server";
import { requireLocalModel } from "./embeddings.server";
import { z } from "zod";
import {
  ConversationError,
  getConversations,
  type ConversationRepository,
} from "./conversations.server";
import { conversationFailure, checkLocalConversationRequest } from "./conversation-api.server";
import { handleOllamaChat } from "./ollama.server";
import { readChatStream } from "./chat-stream";
import { resolveModelTag } from "./ollama-config.server";
import { isSupportedModel, canonicalModelTag } from "./model-config";

const schema = z.object({
  conversationId: z.string().uuid(),
  messageId: z.string().uuid(),
  modelId: z
    .string()
    .max(512)
    .refine((id) => isSupportedModel(id) || id.startsWith("ollama:")),
  content: z.string().trim().min(1).max(200000),
});
export async function handleConversationChat(
  request: Request,
  repository?: ConversationRepository,
): Promise<Response> {
  let db: ConversationRepository | undefined;
  let assistantId: string | undefined;
  let content = "";
  let finalized = false;
  const controller = new AbortController();
  const save = (status: "pending" | "complete" | "interrupted" | "error") => {
    if (!db || !assistantId || finalized) return;
    db.saveReply(assistantId, content, status);
    if (status !== "pending") finalized = true;
  };
  const abort = () => {
    controller.abort();
    try {
      save("interrupted");
    } catch {
      /* Deleted records stay deleted; failed checkpoints recover on restart. */
    }
  };
  try {
    checkLocalConversationRequest(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      throw new ConversationError(
        "Choose a conversation and model, and send a non-empty message.",
        400,
      );
    const { conversationId, messageId, modelId, content: prompt } = parsed.data;
    db = repository ?? getConversations();
    db.get(conversationId);
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    controller.signal.throwIfAborted();
    const tag = isSupportedModel(modelId)
      ? resolveModelTag(modelId)
      : canonicalModelTag(modelId.slice("ollama:".length));
    controller.signal.throwIfAborted();
    const conversation = db.beginTurn(conversationId, messageId, prompt, tag);
    assistantId = `${messageId}:assistant`;
    const messages: { role: string; content: string }[] = conversation.messages
      .filter((m) => m.status === "complete")
      .map(({ role, content }) => ({ role, content }));
    if (db.documents.list(conversationId).length) {
      await requireLocalModel(tag, controller.signal);
      const sources = await retrieveDocuments(
        db.documents,
        conversationId,
        prompt,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      db.documents.saveSources(assistantId, sources);
      messages.unshift({ role: "system", content: documentContext(sources) });
    }
    const upstream = await handleOllamaChat(
      new Request(request.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          modelId,
          messages,
        }),
      }),
    );
    if (!upstream.ok || !upstream.body) {
      save("error");
      request.signal.removeEventListener("abort", abort);
      return upstream;
    }
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(out) {
        try {
          for await (const event of readChatStream(upstream.body!, controller.signal)) {
            if (closed) break;
            content += event.text;
            // Commit before exposing tokens, especially the final done event.
            save(event.done ? "complete" : "pending");
            out.enqueue(
              encoder.encode(
                JSON.stringify({ message: { content: event.text }, done: event.done }) + "\n",
              ),
            );
          }
        } catch (error) {
          let message = error instanceof Error ? error.message : "The reply was interrupted.";
          try {
            save(controller.signal.aborted ? "interrupted" : "error");
          } catch {
            message =
              "Could not save the reply locally. Check disk space and reload this conversation.";
          }
          if (!closed) out.enqueue(encoder.encode(JSON.stringify({ error: message }) + "\n"));
        } finally {
          request.signal.removeEventListener("abort", abort);
          if (!closed) {
            closed = true;
            out.close();
          }
        }
      },
      cancel() {
        closed = true;
        abort();
        request.signal.removeEventListener("abort", abort);
      },
    });
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
    });
  } catch (error) {
    try {
      save(controller.signal.aborted ? "interrupted" : "error");
    } catch {
      /* Surface the request failure. */
    }
    request.signal.removeEventListener("abort", abort);
    if (error instanceof Error && "status" in error && typeof error.status === "number")
      return Response.json({ error: error.message }, { status: error.status });
    return conversationFailure(error);
  }
}
