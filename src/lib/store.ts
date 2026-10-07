import { useSyncExternalStore } from "react";

// Tiny client store for prototype state. Swap for a real runtime adapter later.

interface AppState {
  installed: string[];
  running: string | null;
  activeModelId: string;
}

let state: AppState = { installed: ["qwen-7b"], running: "qwen-7b", activeModelId: "qwen-7b" };
const listeners = new Set<() => void>();

export const appStore = {
  get: () => state,
  set(patch: Partial<AppState>) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useAppState() {
  return useSyncExternalStore(appStore.subscribe, appStore.get, appStore.get);
}
