import type { Conversation, ModelFit, ModelInfo, SystemInfo } from "./types";

// Mocked data. Replace with real hardware detection / model catalog later.

export const mockSystem: SystemInfo = {
  chip: "Apple M2",
  memoryGB: 16,
  platform: "Apple Silicon",
  os: "macOS",
  architecture: "ARM64",
  acceleration: "Apple Metal",
  recommendedMaxSize: "Medium",
};

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
    description: "Smarter on hard problems, but uses most of your memory.",
    capabilities: { chat: "Excellent", writing: "Excellent", coding: "Excellent", reasoning: "Excellent" },
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
    description: "Very capable, but needs far more memory than this Mac has.",
    capabilities: { chat: "Excellent", writing: "Excellent", coding: "Excellent", reasoning: "Excellent" },
    advanced: { parameters: "70B", quantization: "Q4", context: "8K" },
  },
];

export const getModel = (id: string): ModelInfo => models.find((m) => m.id === id) ?? models[0]!;

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
