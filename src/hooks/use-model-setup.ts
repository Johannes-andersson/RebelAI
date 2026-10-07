import { useCallback, useEffect, useRef, useState } from "react";
import { modelManager, type ModelAvailability, type InstallProgress } from "@/lib/model-manager";

export type SetupPhase =
  "checking" | "available" | "missing" | "installing" | "ready" | "error" | "cancelled";
interface SetupState {
  modelId: string | null;
  phase: SetupPhase;
  availability: ModelAvailability | null;
  progress: InstallProgress | null;
  error: string | null;
}
const initial: SetupState = {
  modelId: null,
  phase: "checking",
  availability: null,
  progress: null,
  error: null,
};

export function useModelSetup(modelId: string | null, enabled: boolean) {
  const [state, setState] = useState<SetupState>(initial);
  const active = useRef<AbortController | null>(null);
  const pulling = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    active.current?.abort();
    if (!modelId) return;
    const controller = new AbortController();
    active.current = controller;
    setState({ ...initial, modelId });
    try {
      const availability = await modelManager.check(modelId, controller.signal);
      if (active.current !== controller || controller.signal.aborted) return;
      setState({
        ...initial,
        modelId,
        availability,
        phase: availability.installed ? "available" : "missing",
      });
    } catch (error) {
      if (active.current !== controller || controller.signal.aborted) return;
      setState({
        ...initial,
        modelId,
        phase: "error",
        error: error instanceof Error ? error.message : "Could not check Ollama. Please retry.",
      });
    }
  }, [modelId]);

  useEffect(() => {
    if (enabled) void check();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [enabled, check]);

  async function install(): Promise<ModelAvailability | undefined> {
    if (
      !state.availability ||
      state.modelId !== modelId ||
      (pulling.current && !pulling.current.signal.aborted)
    )
      return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    pulling.current = controller;
    setState((s) => ({ ...s, phase: "installing", error: null, progress: null }));
    try {
      const verified = await modelManager.install(
        state.availability,
        (progress) => {
          if (active.current === controller && !controller.signal.aborted)
            setState((s) => ({ ...s, progress }));
        },
        controller.signal,
      );
      if (active.current !== controller || controller.signal.aborted) return;
      setState((s) => ({ ...s, phase: "ready", availability: verified }));
      return verified;
    } catch (error) {
      if (active.current !== controller || controller.signal.aborted) return;
      setState((s) => ({
        ...s,
        phase: "error",
        error: error instanceof Error ? error.message : "Model installation failed. Please retry.",
      }));
    } finally {
      if (pulling.current === controller) pulling.current = null;
    }
    return undefined;
  }

  function cancel() {
    active.current?.abort();
    active.current = null;
    setState((s) => ({
      ...s,
      phase: "cancelled",
      error:
        "Installation cancelled. Ollama may keep partial files so a retry can resume. Other downloads of this model may continue.",
    }));
  }

  // Never show a previous model's status while its replacement is being checked.
  return { ...(state.modelId === modelId ? state : initial), check, install, cancel };
}
