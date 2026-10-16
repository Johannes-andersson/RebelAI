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
  activity?: import("./tool-plan").ToolActivity[] | undefined;
  attachments?: import("./document-config").AttachedDocument[] | undefined;
  reminderAction?: import("./reminder-config").ReminderAction | undefined;
  taskAction?: import("./task-config").TaskAction | undefined;
  calendarAction?: import("./calendar-action").CalendarAction | undefined;
  performance?: import("./generation-config").GenerationPerformance | undefined;
  webSearch?: import("./web-search").WebSearch | undefined;
  memoryAction?: import("./memory-config").MemoryAction | undefined;
  memoryUsed?: boolean | undefined;
  sources?: import("./document-config").DocumentSource[] | undefined;
  conversationId: string;
  createdAt: string;
  status: "pending" | "complete" | "interrupted" | "error";
}
export interface ConversationSummary {
  isEmpty?: boolean | undefined;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelTag: string | null;
}
export interface Conversation extends ConversationSummary {
  messages: StoredMessage[];
}
