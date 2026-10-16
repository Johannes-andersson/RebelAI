import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { reminderRequest } from "@/lib/reminders";
import { taskRequest } from "@/lib/tasks";
import { calendar } from "@/lib/calendar";
import { zonedInstant, zonedParts } from "@/lib/calendar-time";
import type { ReminderInput, ReminderAction } from "@/lib/reminder-config";
import { RecurrenceFields } from "./recurrence-fields";
export function ReminderFields({
  value,
  onChange,
}: {
  value: ReminderInput;
  onChange: (v: ReminderInput) => void;
}) {
  const settings = useQuery({ queryKey: ["reminders"], queryFn: () => reminderRequest() });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => taskRequest() }),
    events = useQuery({ queryKey: ["calendar"], queryFn: calendar.list });
  const parts = zonedParts(new Date(value.dueAt), value.timeZone);
  const [local, setLocal] = useState(`${parts.date}T${parts.time.slice(0, 5)}`),
    [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <label className="block">
        Reminder title
        <input
          className="block w-full bg-background p-2"
          maxLength={200}
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <label>
        Attached to
        <select
          className="ml-2 bg-background p-2"
          value={value.targetKind}
          onChange={(e) =>
            onChange({
              ...value,
              targetKind: e.target.value as ReminderInput["targetKind"],
              targetId: null,
              leadMinutes:
                e.target.value === "standalone" ? 0 : (settings.data?.settings.lead ?? 15),
            })
          }
        >
          {["standalone", "task", "event"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      {value.targetKind !== "standalone" && (
        <label>
          Target
          <select
            className="bg-background p-2"
            value={value.targetId ?? ""}
            onChange={(e) => onChange({ ...value, targetId: e.target.value || null })}
          >
            <option value="">Choose…</option>
            {(value.targetKind === "task" ? tasks.data?.tasks : events.data)?.map((t) => (
              <option value={t.id} key={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {value.targetKind === "standalone" ? (
        <>
          <label className="block">
            Reminder time ({value.timeZone})
            <input
              required
              type="datetime-local"
              className="bg-background p-2"
              value={local}
              onChange={(e) => {
                setLocal(e.target.value);
                try {
                  const [d, t] = e.target.value.split("T");
                  onChange({ ...value, dueAt: zonedInstant(d!, t!, value.timeZone) });
                  setError("");
                  e.target.setCustomValidity("");
                } catch {
                  setError("Choose a valid unambiguous time.");
                  e.target.setCustomValidity("Choose a valid unambiguous time.");
                }
              }}
            />
          </label>
          <RecurrenceFields
            value={value.recurrence}
            onChange={(recurrence) => onChange({ ...value, recurrence })}
          />
        </>
      ) : (
        <p className="text-xs">
          Uses the target’s current start/due time. All-day events and tasks without a due time
          cannot send timed reminders.
        </p>
      )}
      <label className="block">
        Minutes before (0 for exact time)
        <input
          type="number"
          min={0}
          max={10080}
          value={value.leadMinutes}
          onChange={(e) => onChange({ ...value, leadMinutes: Number(e.target.value) })}
          className="bg-background p-2"
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />{" "}
        Enabled
      </label>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function ChatReminderAction({ action }: { action: ReminderAction }) {
  const [draft, setDraft] = useState(action.draft),
    [status, setStatus] = useState(action.status),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-3 rounded-xl border border-border bg-panel p-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          const a = await reminderRequest<ReminderAction>({
            kind: "decide",
            id: action.id,
            decision: "confirm",
            draft,
            confirmed: true,
          });
          setStatus(a.status);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not save.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Reminder preview</h3>
      {status === "pending" ? (
        <>
          <fieldset disabled={busy}>
            <ReminderFields value={draft} onChange={setDraft} />
          </fieldset>
          <button className="btn-primary" disabled={busy}>
            Confirm reminder
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const a = await reminderRequest<ReminderAction>({
                  kind: "decide",
                  id: action.id,
                  decision: "cancel",
                  confirmed: true,
                });
                setStatus(a.status);
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Cancel reminder
          </button>
        </>
      ) : (
        <p>
          {status === "saved"
            ? "Reminder scheduled locally; delivery requires Rebel AI to be running."
            : "Reminder cancelled."}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function RemindersPage() {
  const query = useQuery({
      queryKey: ["reminders"],
      queryFn: () => reminderRequest(),
    }),
    client = useQueryClient();
  const [draft, setDraft] = useState<ReminderInput | null>(null),
    [id, setId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [permission, setPermission] = useState("");
  async function change(body: unknown) {
    setBusy(true);
    setError("");
    try {
      await reminderRequest(body);
      window.dispatchEvent(new Event("rebel-reminders-changed"));
      await client.invalidateQueries({ queryKey: ["reminders"] });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="p-8 overflow-auto space-y-4">
      <p>
        Reminders appear while Rebel AI and its server are running. Closed browsers, sleep and
        shutdown prevent timely alerts. Missed reminders older than 24 hours remain in history
        without alerts.
      </p>
      <button
        className="btn-secondary"
        onClick={async () => {
          if (!("Notification" in window)) {
            setPermission("Desktop notifications unavailable. In-app reminders still work.");
            return;
          }
          if (Notification.permission === "default")
            setPermission(await Notification.requestPermission());
          else setPermission(Notification.permission);
        }}
      >
        Enable browser desktop notifications
      </button>
      <p role="status">{permission}</p>
      <label className="block">
        <input
          type="checkbox"
          checked={query.data?.settings.enabled ?? false}
          onChange={(e) =>
            void change({
              kind: "settings",
              enabled: e.target.checked,
              lead: query.data?.settings.lead ?? 15,
              confirmed: true,
            })
          }
        />{" "}
        Allow reminder alerts
      </label>
      <label>
        Default lead time
        <select
          value={query.data?.settings.lead ?? 15}
          onChange={(e) =>
            void change({
              kind: "settings",
              enabled: query.data?.settings.enabled ?? true,
              lead: Number(e.target.value),
              confirmed: true,
            })
          }
        >
          {[0, 5, 15, 30, 60].map((n) => (
            <option key={n} value={n}>
              {n} minutes
            </option>
          ))}
        </select>
      </label>
      <button
        className="btn-primary block"
        onClick={() => {
          setId(crypto.randomUUID());
          setDraft({
            title: "",
            dueAt: new Date(Date.now() + 3600000).toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            enabled: true,
            targetKind: "standalone",
            targetId: null,
            leadMinutes: 0,
            recurrence: null,
          });
        }}
      >
        New reminder
      </button>
      {(error || query.error) && <p role="alert">{error || query.error?.message}</p>}
      {draft && (
        <form
          className="rounded-xl border border-border bg-panel p-4 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await change({ kind: "save", id, draft, confirmed: true })) setDraft(null);
          }}
        >
          <ReminderFields value={draft} onChange={setDraft} />
          <button className="btn-primary" disabled={busy}>
            Confirm reminder
          </button>
          <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
            Cancel
          </button>
        </form>
      )}
      <h2>Saved reminders</h2>
      {query.data?.reminders.map((r) => (
        <div key={r.id} className="rounded border border-border p-3">
          {r.title} · {r.enabled ? "Enabled" : "Disabled"}
          <button
            className="ml-3 link-quiet"
            onClick={() => {
              const { id, createdAt: _created, ...input } = r;
              setId(id);
              setDraft(input);
            }}
          >
            Edit / disable
          </button>
        </div>
      ))}
      <h2>Reminder history and pending alerts</h2>
      {query.data?.history.map((r) => (
        <div key={r.id} className="rounded border border-border p-3">
          <p>
            {r.title} · {new Date(r.dueAt).toLocaleString()}
          </p>
          <p>
            {r.status === "delivered" ? "Available in app" : r.status} · desktop: {r.desktop}
          </p>
          {r.status === "delivered" && (
            <>
              <button
                disabled={busy}
                className="btn-secondary"
                onClick={() => void change({ kind: "status", id: r.id, status: "acknowledged" })}
              >
                Acknowledge
              </button>
              <button
                disabled={busy}
                className="btn-secondary"
                onClick={() => void change({ kind: "status", id: r.id, status: "dismissed" })}
              >
                Dismiss
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
