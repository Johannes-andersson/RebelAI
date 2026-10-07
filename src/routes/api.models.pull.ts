import { createFileRoute } from "@tanstack/react-router";
import { handleModelPull } from "@/lib/ollama-models.server";

export const Route = createFileRoute("/api/models/pull")({
  server: { handlers: { POST: ({ request }) => handleModelPull(request) } },
});
