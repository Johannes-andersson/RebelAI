import { createFileRoute } from "@tanstack/react-router";
import { handleConversationChat } from "@/lib/conversation-chat.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: ({ request }) => handleConversationChat(request),
    },
  },
});
