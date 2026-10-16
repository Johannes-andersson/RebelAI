// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationRepository } from "./conversations.server";
import { reminderRequest } from "./reminders.server";
import { emptyTask } from "./task-config";
it("claims once, persists delivery and catches up without stale floods", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-reminders-")),
    path = join(dir, "test.sqlite");
  let db = new ConversationRepository(path);
  const now = new Date("2026-10-14T12:00:00Z");
  try {
    const draft = reminderRequest("Remind me in 20 minutes to check the oven", "UTC", now)!;
    db.reminders.save(draft);
    expect(db.reminders.claim(now)).toHaveLength(0);
    expect(db.reminders.claim(new Date(now.getTime() + 1200000))).toHaveLength(1);
    expect(db.reminders.claim(new Date(now.getTime() + 1200000))).toHaveLength(0);
    db.close();
    db = new ConversationRepository(path);
    expect(db.reminders.history()[0]?.status).toBe("delivered");
    const pending = db.reminders.pending()[0]!;
    expect(pending.title).toBe(draft.title);
    expect(db.reminders.reserveDesktop(pending.id)).toBe(true);
    expect(db.reminders.reserveDesktop(pending.id)).toBe(false);
    db.close();
    db = new ConversationRepository(path);
    expect(db.reminders.pending()[0]?.desktop).toBe("attempted");
    expect(db.reminders.reserveDesktop(pending.id)).toBe(false);
    db.reminders.updateDelivery(pending.id, "acknowledged");
    expect(db.reminders.pending()).toEqual([]);
    expect(db.reminders.claim(new Date(now.getTime() + 1200000))).toEqual([]);
    db.reminders.save({ ...draft, title: "Stale", dueAt: "2026-10-01T12:00:00Z" });
    expect(db.reminders.claim(now)).toHaveLength(0);
    expect(db.reminders.history().some((d) => d.status === "missed")).toBe(true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("bounds alert batches and honors disabled delivery", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const now = new Date(),
      draft = reminderRequest("Remind me in 1 minute to test", "UTC", now)!;
    for (let i = 0; i < 8; i++) db.reminders.save(draft);
    db.reminders.configure(false, 15);
    const later = new Date(now.getTime() + 60000);
    expect(db.reminders.claim(later)).toHaveLength(0);
    db.reminders.configure(true, 15);
    expect(db.reminders.claim(later)).toHaveLength(5);
    expect(db.reminders.claim(later)).toHaveLength(3);
    expect(db.reminders.claim(later)).toHaveLength(0);
  } finally {
    db.close();
  }
});
it("recalculates task due times and suppresses completed tasks", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const task = db.tasks.save({
      ...emptyTask("UTC"),
      title: "Report",
      dueDate: "2026-10-15",
      dueTime: "12:00",
    });
    const draft = {
      ...reminderRequest("Remind me in 20 minutes to test", "UTC")!,
      targetKind: "task" as const,
      targetId: task.id,
      leadMinutes: 30,
    };
    db.reminders.save(draft);
    expect(db.reminders.claim(new Date("2026-10-15T11:30Z"))).toHaveLength(1);
    db.tasks.save({ ...emptyTask("UTC"), title: "Report", completed: true }, task.id, task.version);
    expect(db.reminders.claim(new Date("2026-10-16T11:30Z"))).toHaveLength(0);
  } finally {
    db.close();
  }
});
it("schedules recurring reminders in the correct zone and clarifies morning", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const r = reminderRequest(
      "Remind me every Friday at 5 PM to review my tasks",
      "America/New_York",
      new Date("2026-10-29T12:00Z"),
    )!;
    db.reminders.save(r);
    expect(db.reminders.claim(new Date("2026-10-30T21:00Z"))).toHaveLength(1);
    expect(db.reminders.claim(new Date("2026-11-06T22:00Z"))).toHaveLength(1);
    expect(() => reminderRequest("Remind me tomorrow morning to send the report", "UTC")).toThrow(
      "What time",
    );
  } finally {
    db.close();
  }
});
it("uses recurring event cancellations and edited times", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const event = db.calendar.save({
      title: "Team",
      description: "",
      startsAt: "2026-10-16T17:00:00Z",
      endsAt: null,
      allDay: false,
      source: "manual",
      timeZone: "UTC",
      recurrence: { frequency: "weekly", weekdays: [5], until: null, count: 3 },
    });
    db.reminders.save({
      ...reminderRequest("Remind me in 20 minutes to Team", "UTC")!,
      targetKind: "event",
      targetId: event.id,
      leadMinutes: 15,
    });
    db.calendar.exception(event.id, "2026-10-23", null);
    expect(db.reminders.claim(new Date("2026-10-16T16:45Z"))).toHaveLength(1);
    expect(db.reminders.claim(new Date("2026-10-23T17:00Z"))).toHaveLength(0);
  } finally {
    db.close();
  }
});
