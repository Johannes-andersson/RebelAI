import { calendarActionSchema, type ActionDraft } from "./calendar-action";
import { calendarEventSchema, type EventInput } from "./calendar-config";
async function request(method: string, id?: string, event?: EventInput) {
  const response = await fetch(`/api/calendar${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
    method,
    cache: "no-store",
    ...(event
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmed: true, event }),
        }
      : {}),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Could not access your local calendar. Please retry.");
  }
  return response.status === 204 ? null : response.json();
}
export const calendar = {
  async occurrences(from: string, to: string) {
    const r = await fetch(`/api/calendar?from=${from}&to=${to}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d as ReturnType<typeof import("./recurrence").expandEvents>;
  },
  async exception(id: string, occurrenceDate: string, event: EventInput | null) {
    const r = await fetch(`/api/calendar?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmed: true, occurrenceDate, event }),
    });
    if (!r.ok) throw new Error("Could not update occurrence.");
  },
  async decide(actionId: string, decision: "confirm" | "cancel", draft?: ActionDraft) {
    const response = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId, decision, confirmed: true, ...(draft ? { draft } : {}) }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(data?.error ?? "Could not save the calendar action. Please retry.");
    return calendarActionSchema.parse(data);
  },
  list: async () => calendarEventSchema.array().parse(await request("GET")),
  save: async (event: EventInput, id?: string) =>
    calendarEventSchema.parse(await request(id ? "PATCH" : "POST", id, event)),
  remove: async (id: string) => {
    await request("DELETE", id);
  },
};
