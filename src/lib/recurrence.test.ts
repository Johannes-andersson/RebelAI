import { it, expect } from "vitest";
import { expandEvents } from "./recurrence";
import type { CalendarEvent } from "./calendar-config";
const event: CalendarEvent = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Meeting",
  description: "",
  startsAt: "2026-03-02T14:00:00.000Z",
  endsAt: null,
  allDay: false,
  source: "manual",
  createdAt: "",
  updatedAt: "",
  timeZone: "America/New_York",
  recurrence: { frequency: "weekly", weekdays: [1], until: null, count: 4 },
};
it("retains local weekly time across DST and bounds count", () => {
  const r = expandEvents([event], "2026-03-01", "2026-04-01");
  expect(r.items.map((e) => e.startsAt)).toEqual([
    "2026-03-02T14:00:00.000Z",
    "2026-03-09T13:00:00.000Z",
    "2026-03-16T13:00:00.000Z",
    "2026-03-23T13:00:00.000Z",
  ]);
});
it("skips shorter months and honors end dates and cancelled occurrences", () => {
  const e = {
    ...event,
    startsAt: "2026-01-31T14:00:00.000Z",
    recurrence: { frequency: "monthly" as const, weekdays: [], until: "2026-05-01", count: null },
  };
  expect(expandEvents([e], "2026-01-01", "2026-06-01").items.map((e) => e.occurrenceDate)).toEqual([
    "2026-01-31",
    "2026-03-31",
  ]);
  expect(
    expandEvents([event], "2026-03-01", "2026-04-01", { [`${event.id}/2026-03-09`]: null }).items,
  ).toHaveLength(3);
});
it("reports nonexistent and repeated local times instead of shifting them", () => {
  const e = {
    ...event,
    startsAt: "2026-03-01T07:30:00.000Z",
    recurrence: { frequency: "weekly" as const, weekdays: [0], until: null, count: 3 },
  };
  expect(expandEvents([e], "2026-03-01", "2026-03-30").notices).toHaveLength(1);
  const fall = { ...e, startsAt: "2026-10-25T05:30:00.000Z" };
  expect(expandEvents([fall], "2026-10-25", "2026-11-15").notices).toHaveLength(1);
});
it("supports selected weekdays and rejects unbounded windows", () => {
  expect(
    expandEvents(
      [{ ...event, recurrence: { frequency: "weekly", weekdays: [1, 3], until: null, count: 4 } }],
      "2026-03-01",
      "2026-04-01",
    ).items.map((e) => e.occurrenceDate),
  ).toEqual(["2026-03-02", "2026-03-04", "2026-03-09", "2026-03-11"]);
  expect(() => expandEvents([event], "2026-01-01", "2028-01-01")).toThrow("366");
});
