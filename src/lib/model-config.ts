import type { HardwareRecommendation, ModelInfo } from "./types";

// Shared catalog estimates. Installed sizes and availability come from Ollama.
export const models: ModelInfo[] = [
  {
    id: "qwen-7b",
    name: "Qwen 7B",
    sizeGB: 5.1,
    memoryGB: 8,
    speed: "Fast",
    fit: "recommended",
    tags: ["fast", "coding"],
    description: "Fast enough for everyday AI and runs completely locally.",
    capabilities: { chat: "Excellent", writing: "Excellent", coding: "Good", reasoning: "Good" },
    advanced: { parameters: "7B", quantization: "Q4", context: "8K" },
  },
  {
    id: "llama-8b",
    name: "Llama 8B",
    sizeGB: 4.9,
    memoryGB: 8,
    speed: "Fast",
    fit: "good",
    tags: ["fast"],
    description: "A friendly all-rounder for conversation and writing.",
    capabilities: { chat: "Excellent", writing: "Good", coding: "Fair", reasoning: "Good" },
    advanced: { parameters: "8B", quantization: "Q4", context: "8K" },
  },
  {
    id: "gemma-9b",
    name: "Gemma 9B",
    sizeGB: 5.8,
    memoryGB: 10,
    speed: "Moderate",
    fit: "good",
    tags: ["reasoning"],
    description: "Thoughtful answers and careful explanations.",
    capabilities: { chat: "Good", writing: "Good", coding: "Good", reasoning: "Excellent" },
    advanced: { parameters: "9B", quantization: "Q4", context: "8K" },
  },
  {
    id: "qwen-14b",
    name: "Qwen 14B",
    sizeGB: 9.0,
    memoryGB: 14,
    speed: "Slow",
    fit: "slow",
    tags: ["coding", "reasoning"],
    description: "Smarter on hard problems, with higher memory requirements.",
    capabilities: {
      chat: "Excellent",
      writing: "Excellent",
      coding: "Excellent",
      reasoning: "Excellent",
    },
    advanced: { parameters: "14B", quantization: "Q4", context: "16K" },
  },
  {
    id: "llama-70b",
    name: "Llama 70B",
    sizeGB: 40,
    memoryGB: 48,
    speed: "Slow",
    fit: "not-recommended",
    tags: ["reasoning"],
    description: "Very capable, but requires at least 48 GB of memory for the model.",
    capabilities: {
      chat: "Excellent",
      writing: "Excellent",
      coding: "Excellent",
      reasoning: "Excellent",
    },
    advanced: { parameters: "70B", quantization: "Q4", context: "8K" },
  },
];

export const getModel = (id: string): ModelInfo => models.find((m) => m.id === id) ?? models[0]!;

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

// Namespaced IDs avoid collisions between catalog IDs and external model tags.
export const installedModelId = (tag: string) => `ollama:${canonicalModelTag(tag)}`;
