import { prepareCalendarAction } from "./calendar-action.server";
import { validTimeZone } from "./calendar-time";
import { performanceSchema, type GenerationPerformance } from "./generation-config";
import { searchIntent } from "./search-intent";
import { runWebSearch, disabledSearch } from "./web-search.server";
import type { WebSearch } from "./web-search";
import { explicitMemoryContent } from "./memory-config";
import { captureMemory, recallMemories } from "./memory-service.server";
import { buildChatContext } from "./chat-context.server";
import type { DocumentSource } from "./document-config";
import { retrieveDocuments } from "./retrieval.server";
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
  timeZone: z.string().max(100).refine(validTimeZone).optional(),
  revision: z
    .object({
      kind: z.enum(["regenerate", "edit"]),
      userMessageId: z.string().uuid(),
      expectedTailId: z.string().max(100),
    })
    .optional(),
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
  let performance: GenerationPerformance | undefined;
  let started = 0;
  const controller = new AbortController();
  const save = (status: "pending" | "complete" | "interrupted" | "error") => {
    if (!db || !assistantId || finalized) return;
    db.saveReply(
      assistantId,
      content,
      status,
      performance
        ? { ...performance, elapsedMs: Math.max(0, globalThis.performance.now() - started) }
        : undefined,
    );
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
    const { conversationId, messageId, modelId, revision } = parsed.data;
    let prompt = parsed.data.content;
    db = repository ?? getConversations();
    const existing = db.get(conversationId);
    if (revision?.kind === "regenerate") {
      const original = existing.messages.find(
        (m) => m.id === revision.userMessageId && m.role === "user",
      );
      if (!original) throw new ConversationError("The original message no longer exists.", 409);
      prompt = original.content;
    }
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) controller.abort();
    controller.signal.throwIfAborted();
    const tag = isSupportedModel(modelId)
      ? resolveModelTag(modelId)
      : canonicalModelTag(modelId.slice("ollama:".length));
    controller.signal.throwIfAborted();
    const conversation = revision
      ? db.reviseTurn(conversationId, messageId, revision, prompt, tag)
      : db.beginTurn(conversationId, messageId, prompt, tag);
    assistantId = `${messageId}:assistant`;
    const memoryCommand = explicitMemoryContent(prompt);
    if (memoryCommand !== null) {
      content = await captureMemory(
        () => db!.memories,
        memoryCommand,
        conversationId,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      save("complete");
      request.signal.removeEventListener("abort", abort);
      return new Response(JSON.stringify({ message: { content }, done: true }) + "\n", {
        headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
      });
    }
    const calendarDraft = await prepareCalendarAction(
      prompt,
      tag,
      parsed.data.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    if (calendarDraft) {
      content = db.calendar.stageAction(
        assistantId,
        revision?.userMessageId ?? messageId,
        calendarDraft,
      );
      finalized = true;
      request.signal.removeEventListener("abort", abort);
      return new Response(JSON.stringify({ message: { content }, done: true }) + "\n", {
        headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
      });
    }
    let documents: DocumentSource[] | null = null;
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
      documents = sources;
    }
    const recalled = await recallMemories(() => db!.memories, prompt, tag, controller.signal);
    let memories = recalled?.memories ?? [];
    try {
      if (!recalled || !db.memories.unchanged(recalled.revision)) memories = [];
    } catch {
      memories = [];
    }
    const intent = searchIntent(
      prompt,
      conversation.messages.filter((m) => m.id !== (revision?.userMessageId ?? messageId)),
    );
    const preferences = db.generation.get(tag);
    const getUpstream = async (web?: WebSearch) => {
      controller.signal.throwIfAborted();
      // Recheck after asynchronous work: disabling/clearing memory remains effective.
      try {
        if (recalled && !db!.memories.unchanged(recalled.revision)) memories = [];
        if (memories.length) db!.memories.markUsed(assistantId!);
      } catch {
        memories = [];
      }
      const messages = buildChatContext(conversation, documents, memories, web);
      started = globalThis.performance.now();
      performance = { modelTag: tag, elapsedMs: 0 };
      const response = await handleOllamaChat(
        new Request(request.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ modelId, messages }),
        }),
        preferences,
        messages.length - conversation.messages.filter((m) => m.status === "complete").length,
      );
      const header = response.headers.get("X-Rebel-Generation");
      if (header) {
        try {
          performance = performanceSchema.parse({
            ...JSON.parse(decodeURIComponent(header)),
            modelTag: tag,
            elapsedMs: 0,
          });
        } catch {
          /* Ignore invalid runtime metadata. */
        }
      }
      return response;
    };
    // Ordinary chat retains its existing HTTP errors; searching starts a status stream.
    const upstream = intent.needed ? undefined : await getUpstream();
    if (upstream && (!upstream.ok || !upstream.body)) {
      save("error");
      request.signal.removeEventListener("abort", abort);
      return upstream;
    }
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(out) {
        try {
          let response = upstream;
          if (!response) {
            const emit = (webSearch: WebSearch) => {
              if (!closed && !controller.signal.aborted)
                out.enqueue(encoder.encode(JSON.stringify({ webSearch }) + "\n"));
            };
            let enabled = false;
            try {
              enabled = db!.internet.enabled();
            } catch {
              /* Fail closed. */
            }
            if (enabled) await requireLocalModel(tag, controller.signal);
            let web = await runWebSearch(() => db!.internet, intent, controller.signal, emit);
            controller.signal.throwIfAborted();
            if (web) {
              if (web.status === "complete" && !db!.internet.enabled()) web = disabledSearch();
              db!.internet.save(assistantId!, web);
              emit(web);
            }
            response = await getUpstream(web);
          }
          if (!response.ok || !response.body) {
            const failure = await response.json().catch(() => null);
            throw new Error(
              typeof failure?.error === "string"
                ? failure.error
                : "The local model could not generate a reply.",
            );
          }
          for await (const event of readChatStream(response.body, controller.signal)) {
            if (closed) break;
            content += event.text;
            if (performance && event.done) performance = { ...performance, ...event.metrics };
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
