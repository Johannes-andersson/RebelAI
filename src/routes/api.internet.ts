import { createFileRoute } from "@tanstack/react-router";
import { handleInternet } from "@/lib/internet-api.server";
export const Route = createFileRoute("/api/internet")({
  server: {
    handlers: {
      GET: ({ request }) => handleInternet(request),
      PATCH: ({ request }) => handleInternet(request),
    },
  },
});
