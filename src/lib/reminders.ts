import type { Reminder, ReminderDelivery } from "./reminder-config";
export async function reminderRequest<
  T = {
    reminders: Reminder[];
    history: ReminderDelivery[];
    pending: ReminderDelivery[];
    settings: { enabled: boolean; lead: number };
  },
>(body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch("/api/reminders", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
    ...(body
      ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ?? "Could not access local reminders.");
  return d;
}
