import { createFileRoute } from "@tanstack/react-router";
import { handleMemories } from "@/lib/memory-api.server";
export const Route = createFileRoute("/api/memories")({
  server: {
    handlers: {
      GET: ({ request }) => handleMemories(request),
      PATCH: ({ request }) => handleMemories(request),
      DELETE: ({ request }) => handleMemories(request),
    },
  },
});
