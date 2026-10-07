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
  memoryBytes: number;
  memoryGB: number;
  platform: string;
  os: string;
  architecture: string;
  acceleration: string;
  recommendation: HardwareRecommendation;
}

export interface HardwareRecommendation {
  tier: "Small" | "Medium" | "Large";
  modelId: string | null;
  budgetGB: number;
  fits: Record<string, ModelFit>;
  reason: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface StoredMessage extends ChatMessage {
  conversationId: string;
  createdAt: string;
  status: "pending" | "complete" | "interrupted" | "error";
}
export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelTag: string | null;
}
export interface Conversation extends ConversationSummary {
  messages: StoredMessage[];
}
