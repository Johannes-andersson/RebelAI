import { z } from "zod";
import { getConversations, type ConversationRepository } from "./conversations.server";
import { checkLocalConversationRequest } from "./conversation-api.server";
import { MemoryError } from "./memory-config";
export async function handleMemories(
  request: Request,
  id?: string,
  repository?: ConversationRepository,
) {
  try {
    checkLocalConversationRequest(request);
    if (id && !z.string().uuid().safeParse(id).success) throw new MemoryError("Invalid memory ID.");
    const db = (repository ?? getConversations()).memories;
    if (request.method === "PATCH" && !id) {
      const data = z
        .object({ enabled: z.boolean() })
        .safeParse(await request.json().catch(() => null));
      if (!data.success) throw new MemoryError("Choose whether memory is on or off.");
      db.setEnabled(data.data.enabled);
    } else if (request.method === "DELETE") {
      if (!id && new URL(request.url).searchParams.get("confirm") !== "clear")
        throw new MemoryError("Confirm before clearing all memories.");
      db.delete(id);
    } else if (request.method !== "GET" || id) throw new MemoryError("Method not allowed.", 405);
    return Response.json(
      { enabled: db.settings().enabled, memories: db.list() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 500;
    return Response.json(
      {
        error:
          error instanceof MemoryError
            ? error.message
            : "Could not access saved memories. Check local storage and retry.",
      },
      { status },
    );
  }
}
