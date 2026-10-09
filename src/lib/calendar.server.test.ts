// @vitest-environment node
import { it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { ConversationRepository } from "./conversations.server";
import { handleCalendar } from "./calendar.server";
const event = {
  title: "Doctor",
  description: "Local only",
  startsAt: "2026-10-09T15:00:00.000Z",
  endsAt: null,
  allDay: false,
  source: "manual" as const,
};
function request(method = "GET", body?: unknown, id?: string, origin = "http://localhost") {
  return new Request(`http://localhost/api/calendar${id ? `?id=${id}` : ""}`, {
    method,
    headers: { origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
it("creates, edits, reloads and deletes events while preserving conversations and preferences", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-calendar-"));
  const path = join(dir, "test.sqlite");
  let db = new ConversationRepository(path);
  try {
    const conversation = randomUUID();
    db.create(conversation, "qwen2.5:7b");
    db.generation.set("qwen2.5:7b", { mode: "custom", temperature: 0.3 });
    const response = await handleCalendar(request("POST", { confirmed: true, event }), db);
    expect(response.status).toBe(200);
    const created = await response.json();
    expect(
      (
        await handleCalendar(
          request("PATCH", { confirmed: true, event: { ...event, title: "Updated" } }, created.id),
          db,
        )
      ).status,
    ).toBe(200);
    db.close();
    db = new ConversationRepository(path);
    expect(await (await handleCalendar(request(), db)).json()).toEqual([
      expect.objectContaining({ id: created.id, title: "Updated", allDay: false }),
    ]);
    expect(db.get(conversation).modelTag).toBe("qwen2.5:7b");
    expect(db.generation.get("qwen2.5:7b").temperature).toBe(0.3);
    expect((await handleCalendar(request("DELETE", undefined, created.id), db)).status).toBe(204);
    expect(db.calendar.list()).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("requires confirmation and rejects invalid event data without writes", async () => {
  const db = new ConversationRepository(":memory:");
  try {
    for (const body of [
      { event },
      { confirmed: false, event },
      { confirmed: true, event: { ...event, title: "" } },
      { confirmed: true, event: { ...event, endsAt: "2020-01-01T00:00:00.000Z" } },
    ])
      expect((await handleCalendar(request("POST", body), db)).status).toBe(400);
    expect(db.calendar.list()).toEqual([]);
  } finally {
    db.close();
  }
});
it("rejects cross-origin writes, invalid IDs and missing events", async () => {
  const db = new ConversationRepository(":memory:");
  try {
    expect(
      (
        await handleCalendar(
          request("POST", { confirmed: true, event }, undefined, "https://evil.example"),
          db,
        )
      ).status,
    ).toBe(403);
    expect((await handleCalendar(request("DELETE", undefined, "bad"), db)).status).toBe(400);
    expect((await handleCalendar(request("DELETE", undefined, randomUUID()), db)).status).toBe(404);
  } finally {
    db.close();
  }
});

it("rejects zero-duration instants even when timestamp formatting differs", async () => {
  const db = new ConversationRepository(":memory:");
  try {
    expect(
      (
        await handleCalendar(
          request("POST", { confirmed: true, event: { ...event, endsAt: "2026-10-09T15:00:00Z" } }),
          db,
        )
      ).status,
    ).toBe(400);
    expect(db.calendar.list()).toEqual([]);
  } finally {
    db.close();
  }
});

const draft = {
  title: "Call Mom",
  description: "",
  location: "Home",
  date: "2026-10-09",
  time: "20:00",
  endDate: "",
  endTime: "",
  allDay: false,
};
function stage(db: ConversationRepository) {
  const conversation = randomUUID(),
    user = randomUUID();
  db.create(conversation, "qwen2.5:7b");
  db.beginTurn(conversation, user, "Remind me to call Mom", "qwen2.5:7b");
  db.calendar.stageAction(`${user}:assistant`, user, {
    draft,
    timeZone: "America/El_Salvador",
    notices: [],
  });
  return { conversation, user, id: `${user}:assistant` };
}
it("persists a pending preview across restart and atomically confirms exactly one event", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-actions-")),
    path = join(dir, "test.sqlite");
  let db = new ConversationRepository(path);
  try {
    const action = stage(db);
    expect(db.calendar.list()).toHaveLength(0);
    db.close();
    db = new ConversationRepository(path);
    expect(db.get(action.conversation).messages[1]?.calendarAction?.status).toBe("pending");
    const body = { actionId: action.id, decision: "confirm", confirmed: true, draft };
    const first = await (await handleCalendar(request("POST", body), db)).json();
    const repeated = await (await handleCalendar(request("POST", body), db)).json();
    expect(repeated.eventId).toBe(first.eventId);
    expect(db.calendar.list()).toHaveLength(1);
    expect(db.calendar.list()[0]).toMatchObject({
      startsAt: "2026-10-10T02:00:00.000Z",
      location: "Home",
    });
    db.close();
    db = new ConversationRepository(path);
    expect(db.get(action.conversation).messages[1]?.calendarAction?.status).toBe("saved");
    const next = randomUUID();
    db.reviseTurn(
      action.conversation,
      next,
      { kind: "regenerate", userMessageId: action.user, expectedTailId: action.id },
      "Remind me to call Mom",
      "qwen2.5:7b",
    );
    db.calendar.stageAction(`${next}:assistant`, action.user, {
      draft,
      timeZone: "UTC",
      notices: [],
    });
    expect(db.calendar.action(`${next}:assistant`)?.status).toBe("saved");
    expect(db.calendar.list()).toHaveLength(1);
    expect((await handleCalendar(request("POST", body), db)).status).toBe(409);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("cancels durably, rejects unconfirmed/invalid saves and leaves failed previews retryable", async () => {
  const db = new ConversationRepository(":memory:");
  try {
    const action = stage(db);
    const body = { actionId: action.id, decision: "confirm", confirmed: true, draft };
    expect((await handleCalendar(request("POST", { ...body, confirmed: false }), db)).status).toBe(
      400,
    );
    expect(
      (await handleCalendar(request("POST", { ...body, draft: { ...draft, date: "" } }), db))
        .status,
    ).toBe(400);
    expect(db.calendar.action(action.id)?.status).toBe("pending");
    expect(db.calendar.list()).toHaveLength(0);
    expect(
      (
        await handleCalendar(
          request("POST", { actionId: action.id, decision: "cancel", confirmed: true }),
          db,
        )
      ).status,
    ).toBe(200);
    expect((await handleCalendar(request("POST", body), db)).status).toBe(409);
    expect(db.calendar.list()).toHaveLength(0);
    expect(db.get(action.conversation).messages[1]?.content).toContain("cancelled");
  } finally {
    db.close();
  }
});

it("rolls back a failed confirmation and allows one successful retry", async () => {
  const db = new ConversationRepository(":memory:");
  try {
    const action = stage(db),
      body = { actionId: action.id, decision: "confirm", confirmed: true, draft };
    const original = db.calendar.save.bind(db.calendar);
    const failing = vi.spyOn(db.calendar, "save").mockImplementation((input) => {
      original(input);
      throw new Error("Simulated disk failure");
    });
    expect((await handleCalendar(request("POST", body), db)).status).toBe(500);
    expect(db.calendar.list()).toHaveLength(0);
    expect(db.calendar.action(action.id)?.status).toBe("pending");
    failing.mockRestore();
    expect((await handleCalendar(request("POST", body), db)).status).toBe(200);
    expect(db.calendar.list()).toHaveLength(1);
  } finally {
    db.close();
  }
});
it("isolates conversations, rejects expired previews, and preserves events when history is removed", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const a = stage(db),
      b = stage(db);
    db.calendar.decideAction(a.id, "confirm", draft);
    expect(db.calendar.action(b.id)?.status).toBe("pending");
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    try {
      expect(() => db.calendar.decideAction(b.id, "confirm", draft)).toThrow("expired");
    } finally {
      clock.mockRestore();
    }
    db.delete(a.conversation);
    expect(db.calendar.list()).toHaveLength(1);
    expect(db.calendar.action(a.id)).toBeUndefined();
  } finally {
    db.close();
  }
});

it("deduplicates a repeated identical request from a different conversation", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const first = stage(db),
      second = stage(db);
    const a = db.calendar.decideAction(first.id, "confirm", draft);
    const b = db.calendar.decideAction(second.id, "confirm", draft);
    expect(a.eventId).toBe(b.eventId);
    expect(db.calendar.list()).toHaveLength(1);
  } finally {
    db.close();
  }
});
