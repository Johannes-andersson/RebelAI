import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MemoryAction } from "@/lib/memory-config";
export function ChatMemoryAction({ action }: { action: MemoryAction }) {
  const [content, setContent] = useState(action.content),
    [category, setCategory] = useState(action.category),
    [status, setStatus] = useState(action.status),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const client = useQueryClient();
  async function decide(decision: "confirm" | "cancel") {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.id, decision, content, category, confirmed: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setStatus(d.status);
      await client.invalidateQueries({ queryKey: ["memories"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save memory.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Memory preview"
      className="mt-3 rounded-xl border border-border bg-panel p-4 space-y-3"
    >
      <h3>Review memory {action.operation}</h3>
      {status === "pending" ? (
        <>
          <label className="block">
            Memory content
            <textarea
              className="w-full bg-background p-2"
              maxLength={1000}
              disabled={busy || action.operation === "delete"}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <label>
            Category (optional)
            <input
              className="bg-background p-2"
              maxLength={80}
              disabled={busy || action.operation === "delete"}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
          <p>Saved only on this computer. Confirmation is required.</p>
          <button
            className="btn-primary"
            disabled={busy || !content.trim()}
            onClick={() => void decide("confirm")}
          >
            Confirm memory
          </button>
          <button
            className="btn-secondary ml-2"
            disabled={busy}
            onClick={() => void decide("cancel")}
          >
            Cancel memory
          </button>
        </>
      ) : (
        <p>{status === "saved" ? "Memory change saved locally." : "Memory request cancelled."}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
