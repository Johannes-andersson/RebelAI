import { resolveEventDate } from "./calendar-action.server";
import { calendarClock } from "./calendar-parser";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  reminderInputSchema,
  reminderActionSchema,
  type Reminder,
  type ReminderInput,
  type ReminderDelivery,
  type ReminderAction,
} from "./reminder-config";
import {
  ConversationError,
  getConversations,
  type ConversationRepository,
} from "./conversations.server";
import { checkLocalConversationRequest, conversationFailure } from "./conversation-api.server";
import { expandEvents } from "./recurrence";
import { zonedInstant, zonedParts } from "./calendar-time";
export class ReminderRepository {
  constructor(
    private db: DatabaseSync,
    private repository: ConversationRepository,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reminder_deliveries(id TEXT PRIMARY KEY,reminderId TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,title TEXT NOT NULL,dueAt TEXT NOT NULL,status TEXT NOT NULL,desktop TEXT NOT NULL DEFAULT 'not-requested');
 CREATE INDEX IF NOT EXISTS reminder_due ON reminder_deliveries(status,dueAt);
 CREATE TABLE IF NOT EXISTS reminder_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL,lead INTEGER NOT NULL);INSERT OR IGNORE INTO reminder_settings VALUES(1,1,15);
 CREATE TABLE IF NOT EXISTS reminder_actions(messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reminder_receipts(userMessageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,data TEXT NOT NULL);`);
  }
  list(): Reminder[] {
    return this.db
      .prepare("SELECT data FROM reminders ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(String(r["data"])));
  }
  history(): ReminderDelivery[] {
    return this.db
      .prepare("SELECT * FROM reminder_deliveries ORDER BY dueAt DESC LIMIT 200")
      .all() as unknown as ReminderDelivery[];
  }
  pending(): ReminderDelivery[] {
    return this.db
      .prepare(
        "SELECT * FROM reminder_deliveries WHERE status='delivered' ORDER BY dueAt LIMIT 200",
      )
      .all() as unknown as ReminderDelivery[];
  }
  reserveDesktop(id: string) {
    return (
      this.settings().enabled &&
      this.db
        .prepare(
          "UPDATE reminder_deliveries SET desktop='attempted' WHERE id=? AND status='delivered' AND desktop='not-requested'",
        )
        .run(id).changes === 1
    );
  }
  settings() {
    const r = this.db.prepare("SELECT * FROM reminder_settings WHERE id=1").get()!;
    return { enabled: !!r["enabled"], lead: Number(r["lead"]) };
  }
  configure(enabled: boolean, lead: number) {
    this.db
      .prepare("UPDATE reminder_settings SET enabled=?,lead=? WHERE id=1")
      .run(Number(enabled), lead);
  }
  save(input: ReminderInput, id: string = randomUUID()) {
    const draft = reminderInputSchema.parse(input);
    if (this.list().length >= 100 && !this.list().some((r) => r.id === id))
      throw new ConversationError(
        "Limit of 100 reminder schedules reached. Disable or edit existing reminders.",
        400,
      );
    if (
      draft.targetKind === "task" &&
      !this.repository.tasks.list().some((t) => t.id === draft.targetId)
    )
      throw new ConversationError("Task no longer exists.", 400);
    if (
      draft.targetKind === "event" &&
      !this.repository.calendar.list().some((e) => e.id === draft.targetId)
    )
      throw new ConversationError("Event no longer exists.", 400);
    if (draft.targetKind === "task") {
      const target = this.repository.tasks.list().find((t) => t.id === draft.targetId)!;
      if (!target.dueDate || !target.dueTime)
        throw new ConversationError(
          "Set a due date and time on the task before adding a reminder.",
          400,
        );
    }
    if (
      draft.targetKind === "event" &&
      this.repository.calendar.list().find((e) => e.id === draft.targetId)?.allDay
    )
      throw new ConversationError(
        "Use a standalone reminder with a specific time for an all-day event.",
        400,
      );
    if (draft.recurrence) {
      const wall = zonedParts(new Date(draft.dueAt), draft.timeZone);
      zonedInstant(wall.date, wall.time.slice(0, 5), draft.timeZone);
      if (draft.recurrence.until && draft.recurrence.until < wall.date)
        throw new ConversationError("The recurrence end must be after its start.", 400);
    }
    const existing = this.list().find((r) => r.id === id),
      value = { ...draft, id, createdAt: existing?.createdAt ?? new Date().toISOString() };
    this.db
      .prepare(
        "INSERT INTO reminders VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(id, JSON.stringify(value));
    this.db
      .prepare("DELETE FROM reminder_deliveries WHERE reminderId=? AND status='scheduled'")
      .run(id);
    return value;
  }
  materialize(now = new Date()) {
    const from = new Date(now.getTime() - 86400000).toISOString().slice(0, 10),
      to = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const candidates: { id: string; reminderId: string; title: string; dueAt: string }[] = [];
    for (const r of this.list()) {
      if (!r.enabled) continue;
      let times: { key: string; due: string }[] = [];
      if (r.targetKind === "task") {
        const task = this.repository.tasks.list().find((t) => t.id === r.targetId);
        if (!task || task.completed || !task.dueDate || !task.dueTime) continue;
        times = [{ key: "task", due: zonedInstant(task.dueDate, task.dueTime, task.timeZone) }];
      } else if (r.targetKind === "event") {
        const e = this.repository.calendar.list().find((e) => e.id === r.targetId);
        if (!e || e.allDay) continue;
        times = this.repository.calendar
          .occurrences(from, to)
          .items.filter((e) => e.seriesId === r.targetId)
          .map((e) => ({ key: e.occurrenceDate, due: e.startsAt }));
      } else if (r.recurrence) {
        times = expandEvents(
          [
            {
              id: r.id,
              title: r.title,
              description: "",
              startsAt: r.dueAt,
              endsAt: null,
              allDay: false,
              source: "manual",
              createdAt: r.createdAt,
              updatedAt: r.createdAt,
              timeZone: r.timeZone,
              recurrence: r.recurrence,
            },
          ],
          from,
          to,
        ).items.map((e) => ({ key: e.occurrenceDate, due: e.startsAt }));
      } else times = [{ key: "once", due: r.dueAt }];
      for (const t of times)
        candidates.push({
          id: `${r.id}/${t.key}`,
          reminderId: r.id,
          title: r.title,
          dueAt: new Date(Date.parse(t.due) - r.leadMinutes * 60000).toISOString(),
        });
    }
    // Recompute scheduled entries so task/event edits, completion, cancellation and deletion cannot leave stale alerts.
    this.db.exec("DELETE FROM reminder_deliveries WHERE status='scheduled'");
    if (candidates.length > 2000)
      throw new ConversationError("Too many reminder occurrences. Reduce the schedule count.", 400);
    for (const c of candidates)
      this.db
        .prepare(
          "INSERT OR IGNORE INTO reminder_deliveries(id,reminderId,title,dueAt,status) VALUES (?,?,?,?,'scheduled')",
        )
        .run(c.id, c.reminderId, c.title, c.dueAt);
  }
  claim(now = new Date()) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.materialize(now);
      this.db
        .prepare(
          "UPDATE reminder_deliveries SET status='missed' WHERE status='scheduled' AND dueAt<?",
        )
        .run(new Date(now.getTime() - 86400000).toISOString());
      const due = this.settings().enabled
        ? (this.db
            .prepare(
              "SELECT * FROM reminder_deliveries WHERE status='scheduled' AND dueAt<=? ORDER BY dueAt LIMIT 5",
            )
            .all(now.toISOString()) as unknown as ReminderDelivery[])
        : [];
      for (const d of due)
        this.db
          .prepare(
            "UPDATE reminder_deliveries SET status='delivered' WHERE id=? AND status='scheduled'",
          )
          .run(d.id);
      this.db.exec("COMMIT");
      return due.map((d) => ({ ...d, status: "delivered" as const }));
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  updateDelivery(id: string, status: "dismissed" | "acknowledged" | "shown" | "failed") {
    if (status === "shown" || status === "failed")
      this.db
        .prepare("UPDATE reminder_deliveries SET desktop=? WHERE id=? AND status='delivered'")
        .run(status, id);
    else this.db.prepare("UPDATE reminder_deliveries SET status=? WHERE id=?").run(status, id);
  }
  action(id: string) {
    const r = this.db.prepare("SELECT data FROM reminder_actions WHERE messageId=?").get(id);
    return r ? reminderActionSchema.parse(JSON.parse(String(r["data"]))) : undefined;
  }
  stage(id: string, userMessageId: string, draft: ReminderInput) {
    const receipt = this.db
      .prepare("SELECT data FROM reminder_receipts WHERE userMessageId=?")
      .get(userMessageId);
    const a: ReminderAction = receipt
      ? { ...JSON.parse(String(receipt["data"])), id }
      : {
          id,
          userMessageId,
          draft,
          status: "pending",
          createdAt: new Date().toISOString(),
          resultId: null,
        };
    this.db.prepare("INSERT INTO reminder_actions VALUES (?,?)").run(id, JSON.stringify(a));
    return a;
  }
  decide(id: string, decision: "confirm" | "cancel", draft?: ReminderInput) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const a = this.action(id);
      if (!a) throw new ConversationError("Reminder preview no longer exists.", 409);
      const receipt = this.db
        .prepare("SELECT data FROM reminder_receipts WHERE userMessageId=?")
        .get(a.userMessageId);
      if (receipt) {
        this.db.exec("COMMIT");
        return reminderActionSchema.parse(JSON.parse(String(receipt["data"])));
      }
      if (decision === "cancel") a.status = "cancelled";
      else {
        if (Date.now() - Date.parse(a.createdAt) > 86400000)
          throw new ConversationError("Reminder preview expired.", 409);
        if (!draft) throw new ConversationError("Review reminder details.", 400);
        a.draft = reminderInputSchema.parse(draft);
        a.resultId = this.save(a.draft).id;
        a.status = "saved";
      }
      this.db
        .prepare("INSERT INTO reminder_receipts VALUES (?,?)")
        .run(a.userMessageId, JSON.stringify(a));
      this.db
        .prepare("UPDATE reminder_actions SET data=? WHERE messageId=?")
        .run(JSON.stringify(a), id);
      this.db.exec("COMMIT");
      return a;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("save"),
    id: z.string().uuid(),
    draft: reminderInputSchema,
    confirmed: z.literal(true),
  }),
  z.object({ kind: z.literal("claim") }),
  z.object({ kind: z.literal("desktop"), id: z.string().max(100) }),
  z.object({
    kind: z.literal("settings"),
    enabled: z.boolean(),
    lead: z.number().int().min(0).max(10080),
    confirmed: z.literal(true),
  }),
  z.object({
    kind: z.literal("status"),
    id: z.string().max(100),
    status: z.enum(["dismissed", "acknowledged", "shown", "failed"]),
  }),
  z.object({
    kind: z.literal("decide"),
    id: z.string().max(100),
    decision: z.enum(["confirm", "cancel"]),
    draft: reminderInputSchema.optional(),
    confirmed: z.literal(true),
  }),
]);
export async function handleReminders(request: Request, repository?: ConversationRepository) {
  try {
    checkLocalConversationRequest(request);
    const db = (repository ?? getConversations()).reminders;
    if (request.method === "POST") {
      const parsed = bodySchema.safeParse(await request.json());
      if (!parsed.success) throw new ConversationError("Review valid reminder details.", 400);
      const b = parsed.data;
      if (b.kind === "claim") return Response.json(db.claim());
      if (b.kind === "desktop") return Response.json({ reserved: db.reserveDesktop(b.id) });
      if (b.kind === "save") db.save(b.draft, b.id);
      if (b.kind === "settings") db.configure(b.enabled, b.lead);
      if (b.kind === "status") db.updateDelivery(b.id, b.status);
      if (b.kind === "decide") return Response.json(db.decide(b.id, b.decision, b.draft));
    } else if (request.method !== "GET") throw new ConversationError("Method not allowed.", 405);
    return Response.json(
      {
        reminders: db.list(),
        history: db.history(),
        pending: db.pending(),
        settings: db.settings(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return conversationFailure(e);
  }
}
export function reminderRequest(
  prompt: string,
  zone: string,
  now = new Date(),
  repository?: ConversationRepository,
): ReminderInput | null {
  const text = prompt
    .trim()
    .replace(
      /^remind me to (.+) (every (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|today|tomorrow|\d{4}-\d{2}-\d{2}) at (.+)$/i,
      "Remind me $2 at $3 to $1",
    );
  const base: ReminderInput = {
    title: "",
    dueAt: now.toISOString(),
    timeZone: zone,
    enabled: true,
    targetKind: "standalone",
    targetId: null,
    leadMinutes: 0,
    recurrence: null,
  };
  const relative = /^(?:please\s+)?remind me in (\d+) (minutes?|hours?) to (.+)$/i.exec(text);
  if (relative) {
    const minutes = Number(relative[1]) * (relative[2]!.startsWith("hour") ? 60 : 1);
    if (minutes < 1 || minutes > 10080)
      throw new ConversationError("Choose a reminder within the next seven days.", 400);
    return {
      ...base,
      title: relative[3]!,
      dueAt: new Date(now.getTime() + minutes * 60000).toISOString(),
    };
  }
  const before = /^(?:notify|remind) me (\d+) minutes? before (?:my |the )?(.+)$/i.exec(text);
  if (before && repository) {
    const name = before[2]!.replace(/\s+(?:meeting|task)$/i, "").toLowerCase();
    const events = repository.calendar.list().filter((e) => e.title.toLowerCase().includes(name));
    const tasks = repository.tasks.list().filter((t) => t.title.toLowerCase().includes(name));
    if (events.length + tasks.length !== 1)
      throw new ConversationError(
        "Please specify one exact event or task title. Nothing was scheduled.",
        400,
      );
    return {
      ...base,
      title: `Reminder: ${events[0]?.title ?? tasks[0]!.title}`,
      targetKind: events.length ? "event" : "task",
      targetId: events[0]?.id ?? tasks[0]!.id,
      leadMinutes: Number(before[1]),
    };
  }
  const scheduled =
    /^remind me (every (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|today|tomorrow|\d{4}-\d{2}-\d{2}) at (.+?) to (.+)$/i.exec(
      text,
    );
  if (scheduled) {
    const recurring = scheduled[1]!.startsWith("every "),
      expression = scheduled[1]!.replace(/^every /i, "").toLowerCase();
    const day = resolveEventDate(expression, zonedParts(now, zone).date),
      time = calendarClock(scheduled[2]!);
    if (!day || !time)
      throw new ConversationError("Specify an unambiguous date and AM/PM time.", 400);
    return {
      ...base,
      title: scheduled[3]!,
      dueAt: zonedInstant(day, time, zone),
      recurrence: recurring
        ? {
            frequency: "weekly",
            weekdays: [
              [
                "sunday",
                "monday",
                "tuesday",
                "wednesday",
                "thursday",
                "friday",
                "saturday",
              ].indexOf(expression),
            ],
            until: null,
            count: null,
          }
        : null,
    };
  }
  if (/^remind me tomorrow morning/i.test(text))
    throw new ConversationError(
      "What time tomorrow morning? Please specify AM/PM. Nothing was scheduled.",
      400,
    );
  return null;
}
