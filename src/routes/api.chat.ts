import { createFileRoute } from "@tanstack/react-router";
import { handleOllamaChat } from "@/lib/ollama.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: ({ request }) => handleOllamaChat(request),
    },
  },
});
