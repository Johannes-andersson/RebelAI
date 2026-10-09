import {
  getConversations,
  type ConversationRepository,
  ConversationError,
} from "./conversations.server";
import { checkLocalConversationRequest } from "./conversation-api.server";
import { internetSchema } from "./web-search";
export async function handleInternet(request: Request, repository?: ConversationRepository) {
  try {
    checkLocalConversationRequest(request);
    const db = (repository ?? getConversations()).internet;
    if (request.method === "PATCH") {
      const data = internetSchema.strict().safeParse(await request.json().catch(() => null));
      if (!data.success)
        throw new ConversationError("Choose whether internet access is on or off.", 400);
      db.setEnabled(data.data.enabled);
    } else if (request.method !== "GET") throw new ConversationError("Method not allowed.", 405);
    return Response.json({ enabled: db.enabled() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ConversationError
            ? error.message
            : "Could not save or load internet permission. Please retry.",
      },
      {
        status: error instanceof ConversationError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
