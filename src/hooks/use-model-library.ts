import { useCallback, useEffect, useRef, useState } from "react";
import { modelManager, type ModelInventory, type InstallProgress } from "@/lib/model-manager";
import { applyModelInventory } from "@/lib/store";

type Operation = { kind: "install" | "remove"; id: string };
export function useModelLibrary() {
  const [inventory, setInventory] = useState<ModelInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const active = useRef<AbortController | null>(null);
  const mutation = useRef(false);

  const publish = useCallback((value: ModelInventory) => {
    setInventory(value);
    applyModelInventory(value);
    setReady(true);
  }, []);

  const refresh = useCallback(
    async (notice: string | null = null) => {
      if (mutation.current) return;
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      setLoading(true);
      setError(notice);
      try {
        const value = await modelManager.list(controller.signal);
        if (active.current === controller && !controller.signal.aborted) publish(value);
      } catch (cause) {
        if (active.current !== controller || controller.signal.aborted) return;
        setReady(false);
        setError(
          cause instanceof Error ? cause.message : "Could not load models. Refresh to retry.",
        );
      } finally {
        if (active.current === controller) setLoading(false);
      }
    },
    [publish],
  );

  useEffect(() => {
    void refresh();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [refresh]);

  async function run(next: Operation) {
    if (mutation.current || loading || !ready) return;
    mutation.current = true;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setOperation(next);
    setProgress(null);
    setError(null);
    try {
      let value: ModelInventory;
      if (next.kind === "install") {
        const status = await modelManager.check(next.id, controller.signal);
        controller.signal.throwIfAborted();
        if (!status.installed)
          await modelManager.install(
            status,
            (p) => {
              if (active.current === controller && !controller.signal.aborted) setProgress(p);
            },
            controller.signal,
          );
        controller.signal.throwIfAborted();
        value = await modelManager.list(controller.signal);
      } else {
        value = await modelManager.remove(next.id, controller.signal);
      }
      if (active.current === controller && !controller.signal.aborted) publish(value);
    } catch (cause) {
      if (active.current !== controller || controller.signal.aborted) return;
      // A lost response may follow a successful deletion; reconcile before another action.
      try {
        const value = await modelManager.list(controller.signal);
        if (active.current === controller && !controller.signal.aborted) publish(value);
      } catch {
        if (active.current === controller && !controller.signal.aborted) setReady(false);
      }
      if (active.current === controller && !controller.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Model operation failed. Refresh and retry.",
        );
    } finally {
      if (active.current === controller) {
        mutation.current = false;
        setOperation(null);
        setProgress(null);
      }
    }
  }

  function cancel() {
    if (operation?.kind !== "install") return;
    active.current?.abort();
    mutation.current = false;
    setOperation(null);
    setProgress(null);
    void refresh(
      "Installation cancelled. Ollama may keep partial files for a retry; downloads started elsewhere may continue.",
    );
  }

  return {
    inventory,
    loading,
    ready,
    error,
    operation,
    progress,
    refresh,
    install: (id: string) => run({ kind: "install", id }),
    remove: (tag: string) => run({ kind: "remove", id: tag }),
    cancel,
  };
}
