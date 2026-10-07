import type { ModelFit } from "./types";

// Compatibility exports: model metadata is shared by onboarding and management.
export { models, getModel } from "./model-config";

export const fitLabel: Record<ModelFit, string> = {
  recommended: "Recommended",
  good: "Will run well",
  slow: "May be slow",
  "not-recommended": "Not recommended for this computer",
};
