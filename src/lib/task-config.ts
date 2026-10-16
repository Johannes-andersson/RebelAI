import { z } from "zod";
import { validDate } from "./calendar-config";
import { validTimeZone, zonedInstant } from "./calendar-time";
export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(4000).default(""),
    notes: z.string().max(4000).default(""),
    priority: z.enum(["low", "medium", "high"]).default("medium"),
    completed: z.boolean().default(false),
    projectId: z.string().uuid().nullable().default(null),
    dueDate: z
      .string()
      .refine((v) => !v || validDate(v))
      .default(""),
    dueTime: z.string().default(""),
    timeZone: z.string().refine(validTimeZone),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.dueTime) {
      try {
        zonedInstant(v.dueDate, v.dueTime, v.timeZone);
      } catch {
        ctx.addIssue({ code: "custom", message: "Choose a valid, unambiguous due date and time." });
      }
    }
  });
export type TaskInput = z.infer<typeof taskInputSchema>;
export type Task = TaskInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};
export type Project = { id: string; name: string };
export const taskActionSchema = z.object({
  id: z.string(),
  userMessageId: z.string(),
  targetId: z.string().uuid().nullable(),
  operation: z.enum(["create", "update", "delete"]),
  version: z.number().int(),
  draft: taskInputSchema,
  status: z.enum(["pending", "saved", "cancelled"]),
  createdAt: z.string(),
  resultId: z.string().nullable(),
});
export type TaskAction = z.infer<typeof taskActionSchema>;
export const emptyTask = (timeZone: string): TaskInput => ({
  title: "",
  description: "",
  notes: "",
  priority: "medium",
  completed: false,
  projectId: null,
  dueDate: "",
  dueTime: "",
  timeZone,
});
export type TaskFilter = {
  status?: string;
  priority?: string;
  project?: string;
  due?: string;
  sort?: string;
};
export function filterTasks(tasks: Task[], filter: TaskFilter, now = new Date()) {
  const rank = { high: 0, medium: 1, low: 2 };
  return tasks
    .filter((t) => {
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: t.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      const overdue =
        !!t.dueDate &&
        !t.completed &&
        (t.dueTime
          ? Date.parse(zonedInstant(t.dueDate, t.dueTime, t.timeZone)) < now.getTime()
          : t.dueDate < today);
      return (
        (!filter.status ||
          filter.status === "all" ||
          t.completed === (filter.status === "completed")) &&
        (!filter.priority || t.priority === filter.priority) &&
        (!filter.project || t.projectId === filter.project) &&
        (!filter.due ||
          (filter.due === "overdue" ? overdue : !!t.dueDate && !t.completed && !overdue))
      );
    })
    .sort((a, b) =>
      filter.sort === "priority"
        ? rank[a.priority] - rank[b.priority]
        : filter.sort === "created"
          ? b.createdAt.localeCompare(a.createdAt)
          : (a.dueDate || "9999").localeCompare(b.dueDate || "9999") ||
            a.dueTime.localeCompare(b.dueTime),
    );
}
