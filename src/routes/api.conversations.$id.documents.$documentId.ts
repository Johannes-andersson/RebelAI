import { createFileRoute } from "@tanstack/react-router";
import { handleDocuments } from "@/lib/document-api.server";
export const Route = createFileRoute("/api/conversations/$id/documents/$documentId")({
  server: {
    handlers: {
      POST: ({ request, params }) => handleDocuments(request, params.id, params.documentId),
      DELETE: ({ request, params }) => handleDocuments(request, params.id, params.documentId),
    },
  },
});
