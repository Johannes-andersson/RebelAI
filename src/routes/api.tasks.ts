import { createFileRoute } from "@tanstack/react-router";
import { handleTasks } from "@/lib/tasks.server";
export const Route = createFileRoute("/api/tasks")({
  server: {
    handlers: {
      GET: ({ request }) => handleTasks(request),
      POST: ({ request }) => handleTasks(request),
    },
  },
});
