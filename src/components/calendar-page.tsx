import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { calendar } from "@/lib/calendar";
import { describeEvent } from "@/lib/calendar-parser";
import {
  draftInput,
  emptyDraft,
  eventDraft,
  localDate,
  type CalendarEvent,
  type EventDraft,
} from "@/lib/calendar-config";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

export function CalendarPage() {
  const client = useQueryClient();
  const events = useQuery({ queryKey: ["calendar"], queryFn: calendar.list, retry: false });
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [editing, setEditing] = useState<string | undefined>();
  const [description, setDescription] = useState("");
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);
  const [showPast, setShowPast] = useState(false);
  const today = localDate(new Date());
  const visible = events.data?.filter(
    (e) =>
      showPast ||
      (e.allDay
        ? (e.endsAt ?? e.startsAt) >= today
        : (e.endsAt ?? e.startsAt) >= new Date().toISOString()),
  );
  const field = (name: keyof EventDraft, value: string | boolean) =>
    setDraft((d) => (d ? { ...d, [name]: value } : d));
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      await calendar.save(draftInput(draft), editing);
      setDraft(null);
      setDescription("");
      await client.invalidateQueries({ queryKey: ["calendar"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this event. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleting || busy) return;
    setBusy(true);
    setError(null);
    try {
      await calendar.remove(deleting.id);
      if (editing === deleting.id) setDraft(null);
      setDeleting(null);
      await client.invalidateQueries({ queryKey: ["calendar"] });
    } catch {
      setError("Could not delete this event. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex-1 overflow-y-auto p-10 space-y-6">
      <p className="text-sm text-muted-foreground">
        Saved only on this computer. Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}.
        No notifications, recurring events, or calendar sync.
      </p>
      <section
        className="rounded-xl border border-border bg-panel p-5 space-y-3"
        aria-label="Describe an event"
      >
        <h2 className="font-medium">Describe event</h2>
        <p className="text-sm text-muted-foreground">
          Prepare a draft locally from a date and time. Try “Add doctor appointment tomorrow at
          3pm”. You always review before saving.
        </p>
        <label className="block text-sm">
          Event description
          <input
            className="mt-1 w-full rounded border border-border bg-background p-2"
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Dinner Saturday at 7pm"
          />
        </label>
        <button
          className="btn-secondary"
          disabled={!description.trim() || busy || !!draft}
          onClick={() => {
            const result = describeEvent(description);
            setDraft(result.draft);
            setNotices(result.notices);
            setEditing(undefined);
            setError(null);
          }}
        >
          Prepare draft
        </button>
        <button
          className="btn-primary ml-2"
          disabled={busy || !!draft}
          onClick={() => {
            setDraft(emptyDraft());
            setEditing(undefined);
            setNotices([]);
            setError(null);
          }}
        >
          New event
        </button>
      </section>
      {(error || events.error) && (
        <div role="alert" className="text-sm text-destructive">
          {error ?? "Could not load the local calendar."}
          {events.error && (
            <button className="link-quiet ml-2" onClick={() => void events.refetch()}>
              Retry calendar
            </button>
          )}
        </div>
      )}
      {draft && (
        <form
          className="rounded-xl border border-border bg-panel p-5 space-y-4"
          aria-label="Review event"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 className="font-medium">{editing ? "Edit event" : "Review event before saving"}</h2>
          {notices.map((n) => (
            <p key={n} className="text-sm text-muted-foreground">
              {n}
            </p>
          ))}
          <fieldset disabled={busy} className="space-y-4">
            <label className="block text-sm">
              Title
              <input
                required
                maxLength={200}
                className="mt-1 w-full rounded border border-border bg-background p-2"
                value={draft.title}
                onChange={(e) => field("title", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Notes
              <textarea
                maxLength={4000}
                className="mt-1 w-full rounded border border-border bg-background p-2"
                value={draft.description}
                onChange={(e) => field("description", e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Location
              <input
                maxLength={500}
                className="mt-1 w-full rounded border border-border bg-background p-2"
                value={draft.location ?? ""}
                onChange={(e) => field("location", e.target.value)}
              />
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.allDay}
                onChange={(e) => field("allDay", e.target.checked)}
              />
              All day
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm">
                Start date
                <input
                  required
                  type="date"
                  className="mt-1 w-full rounded border border-border bg-background p-2"
                  value={draft.date}
                  onChange={(e) => field("date", e.target.value)}
                />
              </label>
              {!draft.allDay && (
                <label className="block text-sm">
                  Start time
                  <input
                    required
                    type="time"
                    className="mt-1 w-full rounded border border-border bg-background p-2"
                    value={draft.time}
                    onChange={(e) => field("time", e.target.value)}
                  />
                </label>
              )}
              <label className="block text-sm">
                {draft.allDay ? "End date (exclusive, optional)" : "End date (optional)"}
                <input
                  type="date"
                  className="mt-1 w-full rounded border border-border bg-background p-2"
                  value={draft.endDate}
                  onChange={(e) => field("endDate", e.target.value)}
                />
              </label>
              {!draft.allDay && (
                <label className="block text-sm">
                  End time (optional)
                  <input
                    type="time"
                    className="mt-1 w-full rounded border border-border bg-background p-2"
                    value={draft.endTime}
                    onChange={(e) => field("endTime", e.target.value)}
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Leaving the end empty saves an event without a duration. Check times carefully near
              daylight-saving changes.
            </p>
            <div className="flex gap-2">
              <button className="btn-primary" type="submit">
                {busy ? "Saving…" : "Confirm and save"}
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => {
                  setDraft(null);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <section aria-label="Saved events" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{showPast ? "All events" : "Upcoming events"}</h2>
          <label className="flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => setShowPast(e.target.checked)}
            />
            Include past events
          </label>
        </div>
        {events.isPending && <p role="status">Loading events…</p>}
        {visible?.length === 0 && (
          <p className="text-sm text-muted-foreground">No events here yet.</p>
        )}
        {visible?.map((event) => (
          <article key={event.id} className="rounded-xl border border-border bg-panel p-4">
            <h3 className="font-medium">{event.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {event.allDay
                ? `${event.startsAt} · All day`
                : new Date(event.startsAt).toLocaleString()}
              {event.endsAt &&
                ` — ${event.allDay ? `${event.endsAt} (exclusive)` : new Date(event.endsAt).toLocaleString()}`}
            </p>
            {event.location && (
              <p className="mt-1 text-sm text-muted-foreground">Location: {event.location}</p>
            )}
            {event.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm">{event.description}</p>
            )}
            <div className="mt-3 flex gap-3">
              <button
                className="link-quiet"
                disabled={busy || !!draft}
                aria-label={`Edit ${event.title}`}
                onClick={() => {
                  setDraft(eventDraft(event));
                  setEditing(event.id);
                  setNotices([]);
                  setError(null);
                }}
              >
                Edit
              </button>
              <button
                className="link-quiet"
                disabled={busy}
                aria-label={`Delete ${event.title}`}
                onClick={() => {
                  setError(null);
                  setDeleting(event);
                }}
              >
                Delete
              </button>
            </div>
          </article>
        ))}
      </section>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete event?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete “{deleting?.title}” from this computer? This cannot be undone.
          </AlertDialogDescription>
          {error && <p role="alert">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <button className="btn-primary" disabled={busy} onClick={() => void remove()}>
              Delete event
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
