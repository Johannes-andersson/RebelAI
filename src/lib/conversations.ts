import { calendarActionSchema } from "./calendar-action";
import { performanceSchema } from "./generation-config";
import { webSearchSchema } from "./web-search";
import { sourceSchema } from "./document-config";
import { z } from "zod";
import type { Conversation, ConversationSummary } from "./types";
const summarySchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  modelTag: z.string().nullable(),
});
const conversationSchema = summarySchema.extend({
  messages: z.array(
    z.object({
      id: z.string(),
      conversationId: z.string(),
      role: z.enum(["user", "assistant"]),
      content: z.string(),
      createdAt: z.string(),
      status: z.enum(["pending", "complete", "interrupted", "error"]),
      webSearch: webSearchSchema.optional(),
      performance: performanceSchema.optional(),
      memoryUsed: z.boolean().optional(),
      calendarAction: calendarActionSchema.optional(),
      sources: sourceSchema.array().optional(),
    }),
  ),
});
async function request(path: string, method = "GET", body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/conversations${path}`, {
    method,
    cache: "no-store",
    signal: signal ?? null,
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }).catch((error: unknown) => {
    if (signal?.aborted) throw error;
    throw new Error(
      "Cannot reach local conversation storage. Check that Rebel AI is running and retry.",
    );
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.error === "string" ? data.error : "The local conversation request failed.",
    );
  }
  return response.status === 204 ? null : response.json();
}
export const conversations = {
  async list(signal?: AbortSignal): Promise<ConversationSummary[]> {
    return summarySchema.array().parse(await request("", "GET", undefined, signal));
  },
  async get(id: string, signal?: AbortSignal): Promise<Conversation> {
    return conversationSchema.parse(
      await request(`/${encodeURIComponent(id)}`, "GET", undefined, signal),
    );
  },
  async create(id: string, modelTag: string | null, signal?: AbortSignal): Promise<Conversation> {
    return conversationSchema.parse(await request("", "POST", { id, modelTag }, signal));
  },
  async update(id: string, modelTag: string | null): Promise<Conversation> {
    return conversationSchema.parse(
      await request(`/${encodeURIComponent(id)}`, "PATCH", { modelTag }),
    );
  },
  async rename(id: string, title: string): Promise<Conversation> {
    return conversationSchema.parse(
      await request(`/${encodeURIComponent(id)}`, "PATCH", { title }),
    );
  },
  async delete(id: string): Promise<void> {
    await request(`/${encodeURIComponent(id)}`, "DELETE");
  },
};
export const conversationKeys = {
  list: ["conversations"] as const,
  detail: (id: string | undefined) => ["conversation", id] as const,
};
