import { createFileRoute } from "@tanstack/react-router";
import { handleMemories } from "@/lib/memory-api.server";
export const Route = createFileRoute("/api/memories/$id")({
  server: {
    handlers: {
      PATCH: ({ request, params }) => handleMemories(request, params.id),
      DELETE: ({ request, params }) => handleMemories(request, params.id),
    },
  },
});
