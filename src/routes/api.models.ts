import { createFileRoute } from "@tanstack/react-router";
import { handleModelStatus } from "@/lib/ollama-models.server";

export const Route = createFileRoute("/api/models")({
  server: { handlers: { GET: ({ request }) => handleModelStatus(request) } },
});
