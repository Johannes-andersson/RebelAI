import { z } from "zod";

export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export const eventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).default(""),
    location: z.string().trim().max(500).optional(),
    startsAt: z.string(),
    endsAt: z.string().nullable(),
    allDay: z.boolean(),
    source: z.enum(["manual", "ai"]).default("manual"),
  })
  .strict()
  .superRefine((event, ctx) => {
    const valid = (value: string) =>
      event.allDay ? validDate(value) : z.string().datetime().safeParse(value).success;
    if (
      !valid(event.startsAt) ||
      (event.endsAt !== null &&
        (!valid(event.endsAt) ||
          (event.allDay
            ? event.endsAt <= event.startsAt
            : Date.parse(event.endsAt) <= Date.parse(event.startsAt))))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Choose a valid start and an end after the start. All-day end dates are exclusive.",
      });
  });
export type EventInput = z.infer<typeof eventInputSchema>;
export const calendarEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  location: z.string().optional(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  allDay: z.boolean(),
  source: z.enum(["manual", "ai"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type EventDraft = {
  title: string;
  description: string;
  location?: string;
  date: string;
  time: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  source: "manual" | "ai";
};
export const emptyDraft = (): EventDraft => ({
  title: "",
  description: "",
  location: "",
  date: "",
  time: "",
  endDate: "",
  endTime: "",
  allDay: false,
  source: "manual",
});
export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function draftInput(draft: EventDraft): EventInput {
  const instant = (date: string, time: string) => {
    if (!validDate(date) || !/^\d{2}:\d{2}$/.test(time))
      throw new Error("Choose a date and time before saving.");
    const value = new Date(`${date}T${time}:00`);
    if (
      Number.isNaN(value.getTime()) ||
      localDate(value) !== date ||
      `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}` !==
        time
    )
      throw new Error("That local time does not exist. Choose another time.");
    return value.toISOString();
  };
  if (!draft.allDay && !!draft.endDate !== !!draft.endTime)
    throw new Error("Provide both the end date and time, or leave both empty.");
  const result = eventInputSchema.safeParse({
    title: draft.title,
    description: draft.description,
    location: draft.location ?? "",
    startsAt: draft.allDay ? draft.date : instant(draft.date, draft.time),
    endsAt: draft.endDate
      ? draft.allDay
        ? draft.endDate
        : instant(draft.endDate, draft.endTime)
      : null,
    allDay: draft.allDay,
    source: draft.source,
  });
  if (!result.success)
    throw new Error(result.error.issues[0]?.message ?? "Check the event details.");
  return result.data;
}
export function eventDraft(event: CalendarEvent): EventDraft {
  const date = (value: string) => (event.allDay ? value : localDate(new Date(value)));
  const time = (value: string) => (event.allDay ? "" : new Date(value).toTimeString().slice(0, 5));
  return {
    title: event.title,
    description: event.description,
    location: event.location ?? "",
    date: date(event.startsAt),
    time: time(event.startsAt),
    endDate: event.endsAt ? date(event.endsAt) : "",
    endTime: event.endsAt ? time(event.endsAt) : "",
    allDay: event.allDay,
    source: event.source,
  };
}
