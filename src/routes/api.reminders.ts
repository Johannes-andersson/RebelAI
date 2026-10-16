import { createFileRoute } from "@tanstack/react-router";
import { handleReminders } from "@/lib/reminders.server";
export const Route = createFileRoute("/api/reminders")({
  server: {
    handlers: {
      GET: ({ request }) => handleReminders(request),
      POST: ({ request }) => handleReminders(request),
    },
  },
});
