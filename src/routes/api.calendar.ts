import { createFileRoute } from "@tanstack/react-router";
import { handleCalendar } from "@/lib/calendar.server";
export const Route = createFileRoute("/api/calendar")({
  server: {
    handlers: {
      GET: ({ request }) => handleCalendar(request),
      POST: ({ request }) => handleCalendar(request),
      PATCH: ({ request }) => handleCalendar(request),
      DELETE: ({ request }) => handleCalendar(request),
    },
  },
});
