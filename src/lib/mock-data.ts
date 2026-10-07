import type { Conversation, ModelFit } from "./types";

// Prototype conversations. Hardware and installed models come from the local server.

// Compatibility exports: model metadata is shared by onboarding and management.
export { models, getModel } from "./model-config";

export const fitLabel: Record<ModelFit, string> = {
  recommended: "Recommended",
  good: "Will run well",
  slow: "May be slow",
  "not-recommended": "Not recommended for this computer",
};

export const seedConversations: Conversation[] = [
  { id: "c1", title: "Getting started with Rebel AI", messages: [] },
  { id: "c2", title: "Explain quantum computing", messages: [] },
  { id: "c3", title: "Help me write Python", messages: [] },
];
