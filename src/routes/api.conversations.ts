import { createFileRoute } from "@tanstack/react-router";
import { handleConversations } from "@/lib/conversation-api.server";
export const Route = createFileRoute("/api/conversations")({
  server: {
    handlers: {
      GET: ({ request }) => handleConversations(request),
      POST: ({ request }) => handleConversations(request),
    },
  },
});
