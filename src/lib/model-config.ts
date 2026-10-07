import type { HardwareRecommendation } from "./types";

// Add a catalog entry and provider tag here to support another local model.
export const ollamaModelTags: Record<string, string> = {
  "qwen-7b": "qwen2.5:7b",
  "llama-8b": "llama3.1:8b",
  "gemma-9b": "gemma2:9b",
  "qwen-14b": "qwen2.5:14b",
  "llama-70b": "llama3.1:70b",
};

export const recommendedModelIds: Record<HardwareRecommendation["tier"], string> = {
  Small: "qwen-7b",
  Medium: "qwen-7b",
  Large: "qwen-14b",
};

export function isSupportedModel(id: string): boolean {
  return Object.hasOwn(ollamaModelTags, id);
}

export function canonicalModelTag(tag: string): string {
  // Only normalize Ollama's implicit :latest; never match a different size/tag.
  return tag.slice(tag.lastIndexOf("/") + 1).includes(":") ? tag : `${tag}:latest`;
}
