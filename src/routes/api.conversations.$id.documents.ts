import { createFileRoute } from "@tanstack/react-router";
import { handleDocuments } from "@/lib/document-api.server";
export const Route = createFileRoute("/api/conversations/$id/documents")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleDocuments(request, params.id),
      POST: ({ request, params }) => handleDocuments(request, params.id),
    },
  },
});
