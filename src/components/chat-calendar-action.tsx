import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { calendar } from "@/lib/calendar";
import { actionEvent, type CalendarAction, type ActionDraft } from "@/lib/calendar-action";
import { conversationKeys } from "@/lib/conversations";
export function ChatCalendarAction({
  action,
  conversationId,
  disabled = false,
}: {
  action: CalendarAction;
  conversationId: string;
  disabled?: boolean;
}) {
  const client = useQueryClient();
  const [result, setResult] = useState<CalendarAction | null>(null);
  const current = result ?? action;
  const [draft, setDraft] = useState(action.draft);
  const valid = (() => {
    try {
      actionEvent(draft, action.timeZone);
      return true;
    } catch {
      return false;
    }
  })();
  const [editing, setEditing] = useState(!valid);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "confirm" | "cancel") {
    if (disabled || inFlight.current || current.status !== "pending") return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await calendar.decide(
        action.id,
        decision,
        decision === "confirm" ? draft : undefined,
      );
      setResult(saved);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["calendar"] }),
        client.invalidateQueries({ queryKey: conversationKeys.detail(conversationId) }),
      ]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save the calendar action. Please retry.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  const field = (key: keyof ActionDraft, value: string | boolean) =>
    setDraft((d) => ({ ...d, [key]: value }));
  if (current.status !== "pending")
    return (
      <section
        aria-label="Calendar action"
        className="mt-3 rounded-xl border border-border bg-panel p-4 text-sm"
      >
        <p>
          {current.status === "saved"
            ? "Saved to your local calendar. No automatic alert will be sent."
            : "Cancelled. No event was created."}
        </p>
        {current.status === "saved" && (
          <>
            <p className="mt-2 font-medium">{current.draft.title}</p>
            <p className="text-muted-foreground">
              {current.draft.date} · {current.draft.allDay ? "All day" : current.draft.time} ·{" "}
              {current.timeZone}
            </p>
            <Link className="link-quiet mt-2 inline-block" to="/calendar">
              Open Calendar
            </Link>
            <p className="mt-1 text-xs text-muted-foreground">
              This confirms the original save; events can later be edited or removed in Calendar.
            </p>
          </>
        )}
      </section>
    );
  return (
    <section
      aria-label="Calendar event preview"
      className="mt-3 rounded-xl border border-border bg-panel p-4 space-y-3"
    >
      <h3 className="font-medium">Review calendar event</h3>
      <p className="text-sm text-muted-foreground">Time zone: {action.timeZone}</p>
      {action.notices.map((notice, index) => (
        <p key={index} className="text-xs text-muted-foreground">
          {notice}
        </p>
      ))}
      {editing ? (
        <fieldset disabled={busy || disabled} className="grid grid-cols-2 gap-3 text-sm">
          <label className="col-span-2">
            Event title
            <input
              className="mt-1 w-full rounded border border-border bg-background p-2"
              value={draft.title}
              maxLength={200}
              onChange={(e) => field("title", e.target.value)}
            />
          </label>
          <label>
            Start date
            <input
              className="mt-1 w-full rounded border border-border bg-background p-2"
              type="date"
              value={draft.date}
              onChange={(e) => field("date", e.target.value)}
            />
          </label>
          {!draft.allDay && (
            <label>
              Start time
              <input
                className="mt-1 w-full rounded border border-border bg-background p-2"
                type="time"
                value={draft.time}
                onChange={(e) => field("time", e.target.value)}
              />
            </label>
          )}
          <label>
            End date (optional){draft.allDay && " — exclusive"}
            <input
              className="mt-1 w-full rounded border border-border bg-background p-2"
              type="date"
              value={draft.endDate}
              onChange={(e) => field("endDate", e.target.value)}
            />
          </label>
          {!draft.allDay && (
            <label>
              End time (optional)
              <input
                className="mt-1 w-full rounded border border-border bg-background p-2"
                type="time"
                value={draft.endTime}
                onChange={(e) => field("endTime", e.target.value)}
              />
            </label>
          )}
          <label className="col-span-2 flex gap-2">
            <input
              type="checkbox"
              checked={draft.allDay}
              onChange={(e) => field("allDay", e.target.checked)}
            />
            All day
          </label>
          <label className="col-span-2">
            Description
            <textarea
              className="mt-1 w-full rounded border border-border bg-background p-2"
              value={draft.description}
              maxLength={4000}
              onChange={(e) => field("description", e.target.value)}
            />
          </label>
          <label className="col-span-2">
            Location
            <input
              className="mt-1 w-full rounded border border-border bg-background p-2"
              value={draft.location}
              maxLength={500}
              onChange={(e) => field("location", e.target.value)}
            />
          </label>
        </fieldset>
      ) : (
        <div className="text-sm space-y-1">
          <p className="font-medium">{draft.title}</p>
          <p>
            {draft.date} · {draft.allDay ? "All day" : draft.time}
            {draft.endDate && ` — ${draft.endDate} ${draft.endTime}`}
          </p>
          {draft.description && <p className="whitespace-pre-wrap">{draft.description}</p>}
          {draft.location && <p>Location: {draft.location}</p>}
        </div>
      )}
      {!valid && (
        <p className="text-sm text-muted-foreground">
          Please complete or correct the date, time, and title above before confirming.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          className="btn-primary"
          disabled={busy || disabled || !valid}
          onClick={() => void decide("confirm")}
        >
          {busy ? "Saving…" : "Confirm event"}
        </button>
        {!editing && (
          <button
            className="btn-secondary"
            disabled={busy || disabled}
            onClick={() => setEditing(true)}
          >
            Edit event
          </button>
        )}
        <button
          className="btn-secondary"
          disabled={busy || disabled}
          onClick={() => void decide("cancel")}
        >
          Cancel event
        </button>
      </div>
    </section>
  );
}
