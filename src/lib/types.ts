// Domain types shared by UI and (future) runtime adapters.

export type ModelFit = "recommended" | "good" | "slow" | "not-recommended";
export type ModelTag = "fast" | "coding" | "reasoning";
export type Rating = "Excellent" | "Good" | "Fair";

export interface ModelInfo {
  id: string;
  name: string;
  sizeGB: number;
  memoryGB: number;
  speed: "Fast" | "Moderate" | "Slow";
  fit: ModelFit;
  tags: ModelTag[];
  description: string;
  capabilities: { chat: Rating; writing: Rating; coding: Rating; reasoning: Rating };
  advanced: { parameters: string; quantization: string; context: string };
}

export interface SystemInfo {
  chip: string;
  memoryGB: number;
  platform: string;
  os: string;
  architecture: string;
  acceleration: string;
  recommendedMaxSize: "Small" | "Medium" | "Large";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
}
