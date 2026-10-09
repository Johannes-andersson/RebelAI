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
