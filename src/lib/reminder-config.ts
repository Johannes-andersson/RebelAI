import { z } from "zod";
import { zoneSchema, recurrenceSchema } from "./recurrence";
export const reminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueAt: z.string().datetime(),
    timeZone: zoneSchema,
    enabled: z.boolean(),
    targetKind: z.enum(["standalone", "task", "event"]),
    targetId: z.string().uuid().nullable(),
    leadMinutes: z.number().int().min(0).max(10080),
    recurrence: recurrenceSchema.nullable(),
  })
  .strict()
  .refine(
    (v) => (v.targetKind === "standalone" ? v.targetId === null : !!v.targetId),
    "Choose a reminder target.",
  );
export type ReminderInput = z.infer<typeof reminderInputSchema>;
export type Reminder = ReminderInput & { id: string; createdAt: string };
export type ReminderDelivery = {
  id: string;
  reminderId: string;
  title: string;
  dueAt: string;
  status: "scheduled" | "delivered" | "dismissed" | "acknowledged" | "missed";
  desktop: "not-requested" | "attempted" | "shown" | "failed";
};
export const reminderActionSchema = z.object({
  id: z.string(),
  userMessageId: z.string(),
  draft: reminderInputSchema,
  status: z.enum(["pending", "saved", "cancelled"]),
  createdAt: z.string(),
  resultId: z.string().nullable(),
});
export type ReminderAction = z.infer<typeof reminderActionSchema>;
