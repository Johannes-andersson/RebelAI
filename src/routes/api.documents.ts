import { createFileRoute } from "@tanstack/react-router";
import { getConversations } from "@/lib/conversations.server";
import { checkLocalConversationRequest, conversationFailure } from "@/lib/conversation-api.server";
export const Route = createFileRoute("/api/documents")({
  server: {
    handlers: {
      GET: ({ request }) => {
        try {
          checkLocalConversationRequest(request);
          return Response.json(getConversations().documents.library(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          return conversationFailure(error);
        }
      },
    },
  },
});
