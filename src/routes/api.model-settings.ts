import { createFileRoute } from "@tanstack/react-router";
import { handleGenerationSettings } from "@/lib/generation.server";
export const Route = createFileRoute("/api/model-settings")({
  server: {
    handlers: {
      GET: ({ request }) => handleGenerationSettings(request),
      PATCH: ({ request }) => handleGenerationSettings(request),
    },
  },
});
