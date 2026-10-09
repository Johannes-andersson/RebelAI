import { z } from "zod";
import { eventInputSchema } from "./calendar-config";
import { validTimeZone, zonedInstant } from "./calendar-time";
export const actionDraftSchema = z
  .object({
    title: z.string().max(200),
    description: z.string().max(4000),
    location: z.string().max(500),
    date: z.string().max(10),
    time: z.string().max(5),
    endDate: z.string().max(10),
    endTime: z.string().max(5),
    allDay: z.boolean(),
  })
  .strict();
export type ActionDraft = z.infer<typeof actionDraftSchema>;
export const calendarActionSchema = z.object({
  id: z.string(),
  userMessageId: z.string(),
  timeZone: z.string(),
  draft: actionDraftSchema,
  notices: z.array(z.string()),
  status: z.enum(["pending", "saved", "cancelled"]),
  eventId: z.string().nullable(),
  createdAt: z.string(),
});
export type CalendarAction = z.infer<typeof calendarActionSchema>;
export const calendarDecisionSchema = z
  .object({
    actionId: z.string().max(100),
    decision: z.enum(["confirm", "cancel"]),
    confirmed: z.literal(true),
    draft: actionDraftSchema.optional(),
  })
  .strict();
export function actionEvent(draft: ActionDraft, timeZone: string) {
  if (!validTimeZone(timeZone)) throw new Error("Choose a valid time zone.");
  if (!draft.allDay && !!draft.endDate !== !!draft.endTime)
    throw new Error("Provide both the end date and time, or leave both empty.");
  const parsed = eventInputSchema.safeParse({
    title: draft.title,
    description: draft.description,
    location: draft.location,
    allDay: draft.allDay,
    source: "ai",
    startsAt: draft.allDay ? draft.date : zonedInstant(draft.date, draft.time, timeZone),
    endsAt: draft.endDate
      ? draft.allDay
        ? draft.endDate
        : zonedInstant(draft.endDate, draft.endTime, timeZone)
      : null,
  });
  if (!parsed.success)
    throw new Error(
      "Complete the title and valid dates/times before confirming. The end must be after the start.",
    );
  return parsed.data;
}
export function calendarCandidate(text: string) {
  // Cheap routing gate only. A structured semantic classifier makes the actual decision.
  return (
    text.length <= 8000 &&
    /\b(calendar|remind|reminder|schedule|appointment|meeting|event|book|plan|put|add|arrange)\b/i.test(
      text,
    )
  );
}
