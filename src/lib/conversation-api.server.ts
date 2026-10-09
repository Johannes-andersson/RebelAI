import { z } from "zod";
import {
  ConversationError,
  getConversations,
  type ConversationRepository,
} from "./conversations.server";

export function conversationFailure(error: unknown): Response {
  return Response.json(
    {
      error:
        error instanceof ConversationError
          ? error.message
          : "Could not save or load local conversations. Check disk space and data-folder permissions, then retry.",
    },
    {
      status: error instanceof ConversationError ? error.status : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export function checkLocalConversationRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (
    (origin && origin !== new URL(request.url).origin) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new ConversationError("Cross-origin conversation requests are not allowed.", 403);
  if (
    ["POST", "PATCH"].includes(request.method) &&
    !request.headers.get("content-type")?.includes("application/json")
  )
    throw new ConversationError("Expected a JSON conversation request.", 415);
}
const modelTag = z.string().min(1).max(512).nullable();
export async function handleConversations(
  request: Request,
  id?: string,
  repository?: ConversationRepository,
) {
  try {
    checkLocalConversationRequest(request);
    if (id !== undefined && !z.string().uuid().safeParse(id).success)
      throw new ConversationError("Invalid conversation ID.", 400);
    const db = repository ?? getConversations();
    let result;
    if (request.method === "GET") result = id ? db.get(id) : db.list();
    else if (request.method === "POST" && !id) {
      const body = z
        .object({ id: z.string().uuid(), modelTag: modelTag.optional() })
        .safeParse(await request.json().catch(() => null));
      if (!body.success) throw new ConversationError("Invalid new conversation.", 400);
      result = db.create(body.data.id, body.data.modelTag ?? null);
    } else if (request.method === "PATCH" && id) {
      const body = z
        .union([
          z.object({ title: z.string().trim().min(1).max(100) }).strict(),
          z.object({ modelTag }).strict(),
        ])
        .safeParse(await request.json().catch(() => null));
      if (!body.success) throw new ConversationError("Invalid conversation update.", 400);
      result =
        "title" in body.data ? db.rename(id, body.data.title) : db.update(id, body.data.modelTag);
    } else if (request.method === "DELETE" && id) {
      db.delete(id);
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    } else throw new ConversationError("Method not allowed.", 405);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return conversationFailure(error);
  }
}
