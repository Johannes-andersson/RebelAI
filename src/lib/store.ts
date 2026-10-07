import type { InstalledModel, ModelInventory } from "./model-manager";
import { useSyncExternalStore } from "react";

// Tiny client store for prototype state. Swap for a real runtime adapter later.

interface AppState {
  installed: string[];
  installedModels: InstalledModel[];
  running: string | null;
  activeModelId: string;
}

let state: AppState = {
  installed: [],
  installedModels: [],
  running: null,
  activeModelId: "qwen-7b",
};
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

// One selection rule for inventory refreshes, installations, and removals.
export function applyModelInventory(inventory: ModelInventory) {
  const installed = inventory.installed.map((m) => m.id);
  const selected = installed.includes(appStore.get().activeModelId)
    ? appStore.get().activeModelId
    : (installed[0] ?? "");
  appStore.set({
    installed,
    installedModels: inventory.installed,
    activeModelId: selected,
    running: selected || null,
  });
}
