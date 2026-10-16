import { Link } from "@tanstack/react-router";
import { useReminderStatus } from "@/lib/reminder-context";
export function NotificationIndicator() {
  const { count, error } = useReminderStatus();
  return (
    <Link
      to="/reminders"
      className="mx-2 my-2 rounded border border-border p-2 text-sm"
      aria-live="polite"
    >
      {error ? "Reminders unavailable — retrying" : `Reminders${count ? ` · ${count} unread` : ""}`}
    </Link>
  );
}
