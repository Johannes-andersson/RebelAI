import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TaskFields } from "./tasks-page";
import { taskRequest } from "@/lib/tasks";
import type { TaskAction } from "@/lib/task-config";
export function ChatTaskAction({
  action,
  disabled = false,
}: {
  action: TaskAction;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(action.draft),
    [status, setStatus] = useState(action.status),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["tasks"], queryFn: () => taskRequest() }),
    client = useQueryClient();
  async function decide(decision: "confirm" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "decide",
          id: action.id,
          decision,
          task: draft,
          confirmed: true,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus(result.status);
      await client.invalidateQueries({ queryKey: ["tasks"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Task preview"
      className="mt-3 rounded-xl border border-border bg-panel p-4 space-y-3"
    >
      <h3>Task: {action.operation}</h3>
      {status === "pending" ? (
        <>
          <fieldset disabled={busy || disabled}>
            <TaskFields value={draft} onChange={setDraft} projects={query.data?.projects ?? []} />
          </fieldset>
          <p>
            Review every detail.{" "}
            {action.operation === "delete"
              ? "Confirmation permanently deletes this task."
              : "Nothing changes until you confirm."}
          </p>
          <button
            className="btn-primary"
            disabled={busy || disabled}
            onClick={() => void decide("confirm")}
          >
            Confirm task
          </button>
          <button
            className="btn-secondary ml-2"
            disabled={busy || disabled}
            onClick={() => void decide("cancel")}
          >
            Cancel task
          </button>
        </>
      ) : (
        <p>{status === "saved" ? "Task action saved locally." : "Task action cancelled."}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
