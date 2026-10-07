import { createFileRoute } from "@tanstack/react-router";
import { handleModelStatus, handleModelDelete } from "@/lib/ollama-models.server";

export const Route = createFileRoute("/api/models")({
  server: {
    handlers: {
      GET: ({ request }) => handleModelStatus(request),
      DELETE: ({ request }) => handleModelDelete(request),
    },
  },
});
