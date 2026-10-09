import {
  actionEvent,
  calendarActionSchema,
  calendarDecisionSchema,
  type CalendarAction,
  type ActionDraft,
} from "./calendar-action";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eventInputSchema, type CalendarEvent, type EventInput } from "./calendar-config";
import {
  ConversationError,
  getConversations,
  type ConversationRepository,
} from "./conversations.server";
import { checkLocalConversationRequest } from "./conversation-api.server";
export class CalendarRepository {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      startsAt TEXT NOT NULL, endsAt TEXT, allDay INTEGER NOT NULL CHECK(allDay IN (0,1)),
      source TEXT NOT NULL CHECK(source IN ('manual','ai')), createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS calendar_start ON calendar_events(startsAt);`);
    if (
      !db
        .prepare("PRAGMA table_info(calendar_events)")
        .all()
        .some((c) => c["name"] === "location")
    )
      db.exec("ALTER TABLE calendar_events ADD COLUMN location TEXT NOT NULL DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS calendar_actions (
      messageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS calendar_action_receipts (
      userMessageId TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, data TEXT NOT NULL);`);
  }
  list(): CalendarEvent[] {
    return this.db
      .prepare("SELECT * FROM calendar_events ORDER BY startsAt,id")
      .all()
      .map((row) => ({ ...row, allDay: !!row["allDay"] })) as CalendarEvent[];
  }
  save(input: EventInput, id?: string) {
    const data = eventInputSchema.parse(input);
    if (!data.allDay) {
      data.startsAt = new Date(data.startsAt).toISOString();
      if (data.endsAt) data.endsAt = new Date(data.endsAt).toISOString();
    }
    const now = new Date().toISOString();
    const eventId = id ?? randomUUID();
    if (id) {
      if (
        !this.db
          .prepare(
            "UPDATE calendar_events SET title=?,description=?,startsAt=?,endsAt=?,allDay=?,source=?,updatedAt=?,location=? WHERE id=?",
          )
          .run(
            data.title,
            data.description,
            data.startsAt,
            data.endsAt,
            Number(data.allDay),
            data.source,
            now,
            data.location ?? "",
            id,
          ).changes
      )
        throw new ConversationError("This event no longer exists.", 404);
    } else
      this.db
        .prepare(
          "INSERT INTO calendar_events (id,title,description,startsAt,endsAt,allDay,source,createdAt,updatedAt,location) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          eventId,
          data.title,
          data.description,
          data.startsAt,
          data.endsAt,
          Number(data.allDay),
          data.source,
          now,
          now,
          data.location ?? "",
        );
    return this.list().find((e) => e.id === eventId)!;
  }
  action(messageId: string): CalendarAction | undefined {
    const row = this.db
      .prepare("SELECT data FROM calendar_actions WHERE messageId=?")
      .get(messageId);
    return row ? calendarActionSchema.parse(JSON.parse(String(row["data"]))) : undefined;
  }
  stageAction(
    messageId: string,
    userMessageId: string,
    input: { draft: ActionDraft; timeZone: string; notices: string[] },
  ) {
    const receipt = this.db
      .prepare("SELECT data FROM calendar_action_receipts WHERE userMessageId=?")
      .get(userMessageId);
    const previous = receipt
      ? calendarActionSchema.parse(JSON.parse(String(receipt["data"])))
      : undefined;
    const action: CalendarAction = previous
      ? { ...previous, id: messageId }
      : {
          ...input,
          id: messageId,
          userMessageId,
          status: "pending",
          eventId: null,
          createdAt: new Date().toISOString(),
        };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("INSERT INTO calendar_actions VALUES (?,?)")
        .run(messageId, JSON.stringify(action));
      const text =
        action.status === "saved"
          ? "This request already saved a calendar event. No duplicate was created. No automatic alert is scheduled."
          : "Review the calendar event below. Complete any missing details, then confirm to save it. No automatic alert will be sent.";
      if (
        !this.db
          .prepare(
            "UPDATE messages SET content=?,status='complete' WHERE id=? AND status='pending'",
          )
          .run(text, messageId).changes
      )
        throw new ConversationError("This calendar request is no longer active.", 409);
      this.db.exec("COMMIT");
      return text;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  decideAction(id: string, decision: "confirm" | "cancel", draft?: ActionDraft) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const action = this.action(id);
      if (!action)
        throw new ConversationError(
          "This calendar preview is no longer active. Reload the conversation.",
          409,
        );
      if (action.status === "saved") {
        this.db.exec("COMMIT");
        return action;
      }
      if (action.status === "cancelled") {
        if (decision === "confirm")
          throw new ConversationError(
            "This calendar request was cancelled. Create a new request to continue.",
            409,
          );
        this.db.exec("COMMIT");
        return action;
      }
      if (decision === "cancel") action.status = "cancelled";
      else {
        if (Date.now() - Date.parse(action.createdAt) > 24 * 60 * 60 * 1000)
          throw new ConversationError(
            "This preview has expired. Send a new request so relative dates can be checked again.",
            409,
          );
        if (!draft) throw new ConversationError("Review event details before confirming.", 400);
        let input: EventInput;
        try {
          input = actionEvent(draft, action.timeZone);
        } catch (error) {
          throw new ConversationError(
            error instanceof Error ? error.message : "Check event details.",
            400,
          );
        }
        const receipt = this.db
          .prepare("SELECT data FROM calendar_action_receipts WHERE userMessageId=?")
          .get(action.userMessageId);
        if (receipt)
          throw new ConversationError(
            "This request has already been confirmed. Reload the conversation.",
            409,
          );
        // A separately submitted but identical confirmed request should not duplicate an event.
        const same = this.list().find(
          (event) =>
            event.title.trim().toLowerCase() === input.title.trim().toLowerCase() &&
            event.startsAt === input.startsAt &&
            event.endsAt === input.endsAt &&
            event.allDay === input.allDay &&
            event.description === input.description &&
            (event.location ?? "") === (input.location ?? ""),
        );
        const event = same ?? this.save(input);
        action.status = "saved";
        action.eventId = event.id;
        action.draft = draft;
        this.db
          .prepare("INSERT INTO calendar_action_receipts VALUES (?,?)")
          .run(action.userMessageId, JSON.stringify(action));
      }
      this.db
        .prepare("UPDATE calendar_actions SET data=? WHERE messageId=?")
        .run(JSON.stringify(action), id);
      this.db
        .prepare("UPDATE messages SET content=? WHERE id=?")
        .run(
          action.status === "saved"
            ? "Saved to your local calendar. No automatic alert will be sent."
            : "Calendar request cancelled. No event was created.",
          id,
        );
      this.db.exec("COMMIT");
      return action;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  delete(id: string) {
    if (!this.db.prepare("DELETE FROM calendar_events WHERE id=?").run(id).changes)
      throw new ConversationError("This event no longer exists.", 404);
  }
}
export async function handleCalendar(request: Request, repository?: ConversationRepository) {
  try {
    checkLocalConversationRequest(request);
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null && !z.string().uuid().safeParse(id).success)
      throw new ConversationError("Invalid event ID.", 400);
    const db = (repository ?? getConversations()).calendar;
    let result: unknown;
    if (request.method === "GET" && !id) result = db.list();
    else if ((request.method === "POST" && !id) || (request.method === "PATCH" && id)) {
      const body = await request.json().catch(() => null);
      if (request.method === "POST" && body && typeof body === "object" && "actionId" in body) {
        const decision = calendarDecisionSchema.safeParse(body);
        if (!decision.success)
          throw new ConversationError("Review and confirm the calendar action first.", 400);
        const value = decision.data;
        return Response.json(db.decideAction(value.actionId, value.decision, value.draft), {
          headers: { "Cache-Control": "no-store" },
        });
      }
      const parsed = z
        .object({ confirmed: z.literal(true), event: eventInputSchema })
        .strict()
        .safeParse(body);
      if (!parsed.success)
        throw new ConversationError("Review and confirm valid event details before saving.", 400);
      result = db.save(parsed.data.event, id ?? undefined);
    } else if (request.method === "DELETE" && id) {
      db.delete(id);
      return new Response(null, { status: 204 });
    } else throw new ConversationError("Method not allowed.", 405);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ConversationError
            ? error.message
            : "Could not access the local calendar. Check local storage and retry.",
      },
      { status: error instanceof ConversationError ? error.status : 500 },
    );
  }
}
