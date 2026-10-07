import { useState } from "react";
import { useMemories } from "@/hooks/use-memories";
import { Toggle } from "@/components/ui-bits";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
export function MemorySettings() {
  const memory = useMemories();
  const [confirm, setConfirm] = useState(false);
  return (
    <section aria-label="Memory settings" className="space-y-6">
      <div className="panel flex items-center justify-between gap-6 px-6 py-5">
        <div>
          <h2 className="font-medium">Memory</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Allow Rebel AI to use saved information across conversations.
          </p>
        </div>
        <fieldset disabled={memory.loading || memory.busy || !memory.state}>
          <Toggle
            label="Enable memory"
            checked={memory.state?.enabled ?? false}
            onChange={(enabled) => {
              void memory.setEnabled(enabled).catch(() => {});
            }}
          />
        </fieldset>
      </div>
      {memory.error && (
        <p role="alert" className="text-sm text-destructive">
          {memory.error}{" "}
          <button className="link-quiet" onClick={memory.reload}>
            Retry
          </button>
        </p>
      )}
      {memory.loading ? (
        <p role="status">Loading saved memories…</p>
      ) : (
        memory.state && (
          <div className="panel px-6 py-5">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="font-medium">Saved Memories</h3>
              <button
                className="link-quiet text-sm"
                disabled={memory.busy || !memory.state.memories.length}
                onClick={() => setConfirm(true)}
              >
                Clear all memories
              </button>
            </div>
            {!memory.state.enabled && (
              <p className="mb-4 text-sm text-muted-foreground">
                Memory is off. Your saved memories remain here and won’t be used until you turn it
                on.
              </p>
            )}
            {!memory.state.memories.length ? (
              <div className="text-sm text-muted-foreground">
                <p>No saved memories yet.</p>
                <p className="mt-1">Tell Rebel AI “Remember that…” in any chat.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {memory.state.memories.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-4 py-4">
                    <p className="min-w-0 whitespace-pre-wrap break-words text-sm">
                      {item.content}
                    </p>
                    <button
                      className="link-quiet shrink-0 text-sm"
                      aria-label={`Delete memory: ${item.content}`}
                      disabled={memory.busy}
                      onClick={() => {
                        void memory.remove(item.id).catch(() => {});
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogTitle>Clear all saved memories?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes all saved memories from this computer. Your conversations and attached
            files will remain.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void memory.clear().catch(() => {});
              }}
            >
              Clear memories
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
