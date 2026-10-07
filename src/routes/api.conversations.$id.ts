import { createFileRoute } from "@tanstack/react-router";
import { handleConversations } from "@/lib/conversation-api.server";
export const Route = createFileRoute("/api/conversations/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleConversations(request, params.id),
      PATCH: ({ request, params }) => handleConversations(request, params.id),
      DELETE: ({ request, params }) => handleConversations(request, params.id),
    },
  },
});
