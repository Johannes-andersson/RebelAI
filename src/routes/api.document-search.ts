import { createFileRoute } from "@tanstack/react-router";
import { handleDocumentSearch } from "@/lib/document-search-api.server";
export const Route = createFileRoute("/api/document-search")({
  server: {
    handlers: {
      GET: ({ request }) => handleDocumentSearch(request),
      POST: ({ request }) => handleDocumentSearch(request),
    },
  },
});
