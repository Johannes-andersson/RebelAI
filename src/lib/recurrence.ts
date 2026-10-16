import { z } from "zod";
import { zonedInstant, zonedParts, validTimeZone } from "./calendar-time";
import type { CalendarEvent } from "./calendar-config";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const recurrenceSchema = z
  .object({
    frequency: z.enum(["daily", "weekly", "monthly"]),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    until: date.nullable().default(null),
    count: z.number().int().min(1).max(1000).nullable().default(null),
  })
  .strict();
export type Recurrence = z.infer<typeof recurrenceSchema>;
export const zoneSchema = z.string().refine(validTimeZone);
export type Occurrence = CalendarEvent & { seriesId: string; occurrenceDate: string };
export function expandEvents(
  events: CalendarEvent[],
  from: string,
  to: string,
  exceptions: Record<string, CalendarEvent | null> = {},
) {
  date.parse(from);
  date.parse(to);
  if (to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000)
    throw new Error("Choose a calendar window of at most 366 days.");
  const items: Occurrence[] = [],
    notices: string[] = [];
  if (events.length > 500)
    throw new Error(
      "Calendar expansion is limited to 500 series. Narrow or archive your calendar.",
    );
  for (const event of events) {
    const zone = event.timeZone ?? "UTC",
      start = event.allDay
        ? { date: event.startsAt, time: "00:00:00" }
        : zonedParts(new Date(event.startsAt), zone);
    const rule = event.recurrence;
    if (!rule) {
      if (start.date >= from && start.date <= to)
        items.push({ ...event, seriesId: event.id, occurrenceDate: start.date });
      continue;
    }
    if (rule.until && rule.until < start.date)
      throw new Error("Recurrence end must not precede the start.");
    const anchor = Date.parse(start.date),
      end = Date.parse(to),
      startDay = new Date(anchor).getUTCDay();
    // Finite scan; a series older than 100 years requires a nearer start, never unbounded work.
    if (end - anchor > 36600 * 86400000) {
      notices.push(`${event.title}: series exceeds the 100-year expansion limit.`);
      continue;
    }
    let count = 0;
    for (let day = anchor; day <= end; day += 86400000) {
      const d = new Date(day),
        key = d.toISOString().slice(0, 10);
      if (rule.until && key > rule.until) break;
      const matches =
        rule.frequency === "daily" ||
        (rule.frequency === "weekly" &&
          (rule.weekdays.length ? rule.weekdays : [startDay]).includes(d.getUTCDay())) ||
        (rule.frequency === "monthly" && key.slice(8) === start.date.slice(8));
      if (!matches) continue;
      if (rule.count && ++count > rule.count) break;
      if (key < from) continue;
      const exceptionKey = `${event.id}/${key}`;
      if (Object.hasOwn(exceptions, exceptionKey)) {
        const override = exceptions[exceptionKey];
        if (override)
          items.push({
            ...override,
            recurrence: event.recurrence,
            id: exceptionKey,
            seriesId: event.id,
            occurrenceDate: key,
          });
        continue;
      }
      try {
        const startsAt = event.allDay ? key : zonedInstant(key, start.time.slice(0, 5), zone);
        let endsAt: string | null = null;
        if (event.endsAt) {
          if (event.allDay)
            endsAt = new Date(Date.parse(key) + Date.parse(event.endsAt) - anchor)
              .toISOString()
              .slice(0, 10);
          else {
            const endParts = zonedParts(new Date(event.endsAt), zone),
              offset = Date.parse(endParts.date) - anchor;
            endsAt = zonedInstant(
              new Date(day + offset).toISOString().slice(0, 10),
              endParts.time.slice(0, 5),
              zone,
            );
          }
        }
        items.push({
          ...event,
          id: exceptionKey,
          seriesId: event.id,
          occurrenceDate: key,
          startsAt,
          endsAt,
        });
      } catch {
        notices.push(
          `${event.title} on ${key}: ambiguous or nonexistent local time; occurrence skipped. Edit the series or add a one-time event.`,
        );
      }
      if (items.length > 2000) throw new Error("Too many occurrences. Narrow the date window.");
    }
  }
  return { items: items.sort((a, b) => a.startsAt.localeCompare(b.startsAt)), notices };
}
