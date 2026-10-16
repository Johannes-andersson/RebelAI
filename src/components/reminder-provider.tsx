import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reminderRequest } from "@/lib/reminders";
import type { ReminderDelivery } from "@/lib/reminder-config";

import { ReminderContext } from "@/lib/reminder-context";

// Lives above the route outlet: page navigation never owns the scheduler or inbox.
export function ReminderProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [pending, setPending] = useState<ReminderDelivery[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const mutation = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    let stopped = false,
      running = false;
    const controller = new AbortController();
    const request = <T,>(body?: unknown) => reminderRequest<T>(body, controller.signal);
    async function tick() {
      if (stopped || running || mutation.current) return;
      running = true;
      const version = revision.current;
      try {
        // A lost claim response must not hide the durable inbox on the next poll.
        await request({ kind: "claim" });
        const state = await reminderRequest(undefined, controller.signal);
        if (stopped || mutation.current || version !== revision.current) return;
        client.setQueryData(["reminders"], state);
        setPending(state.pending);
        setError(false);
        if (
          state.settings.enabled &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          for (const r of state.pending) {
            if (stopped || mutation.current || version !== revision.current) break;
            if (r.desktop !== "not-requested") continue;
            const reserved = await request<{ reserved: boolean }>({ kind: "desktop", id: r.id });
            if (!reserved.reserved || stopped) continue;
            try {
              const notification = new Notification(r.title, {
                body: `Due ${new Date(r.dueAt).toLocaleString()}`,
                tag: r.id,
              });
              notification.onshow = () => {
                if (!stopped)
                  void request({ kind: "status", id: r.id, status: "shown" }).catch(() => {});
              };
              notification.onerror = () => {
                if (!stopped)
                  void request({ kind: "status", id: r.id, status: "failed" }).catch(() => {});
              };
            } catch {
              await request({ kind: "status", id: r.id, status: "failed" });
            }
          }
        }
      } catch {
        if (!stopped) setError(true);
      } finally {
        running = false;
      }
    }
    const wake = () => {
      if (document.visibilityState !== "hidden") void tick();
    };
    void tick();
    const timer = setInterval(() => void tick(), 15000);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("rebel-reminders-changed", wake);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("rebel-reminders-changed", wake);
    };
  }, [client]);
  async function decide(id: string, status: "acknowledged" | "dismissed") {
    if (mutation.current) return;
    mutation.current = true;
    revision.current++;
    setBusy(id);
    try {
      await reminderRequest({ kind: "status", id, status });
      setPending((items) => items.filter((r) => r.id !== id));
      await client.invalidateQueries({ queryKey: ["reminders"] });
      setError(false);
    } catch {
      setError(true);
    } finally {
      mutation.current = false;
      setBusy(null);
    }
  }
  return (
    <ReminderContext.Provider value={{ count: pending.length, error }}>
      {children}
      {pending.length > 0 && (
        <section
          aria-label="Reminder notifications"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] max-h-[50vh] overflow-auto space-y-2 rounded-lg border border-border bg-background p-3 shadow-xl"
        >
          <h2 className="font-semibold">Reminders · {pending.length} unread</h2>
          {pending.map((r) => (
            <article key={r.id} className="rounded border border-border p-3 space-y-2">
              <p className="font-medium break-words">{r.title}</p>
              <p className="text-xs text-muted-foreground">
                Due {new Date(r.dueAt).toLocaleString()}
              </p>
              <div className="flex gap-2">
                <button
                  className="btn-primary"
                  disabled={busy !== null}
                  onClick={() => void decide(r.id, "acknowledged")}
                >
                  Acknowledge
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy !== null}
                  onClick={() => void decide(r.id, "dismissed")}
                >
                  Dismiss
                </button>
              </div>
            </article>
          ))}
          {error && (
            <p role="alert">
              Could not sync reminders. Your alerts remain here; retry when connected.
            </p>
          )}
        </section>
      )}
    </ReminderContext.Provider>
  );
}
