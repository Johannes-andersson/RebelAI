import { z } from "zod";
export const memoryLimits = {
  characters: 1000,
  records: 500,
  retrieved: 3,
  relevance: 0.5,
  styleRelevance: 0.55,
  recallTimeout: 30_000,
  indexBatch: 8,
};
export const memorySchema = z.object({
  category: z.string().max(80).optional(),
  id: z.string().uuid(),
  content: z.string().trim().min(1).max(memoryLimits.characters),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceConversationId: z.string().uuid().nullable(),
});
export type SavedMemory = z.infer<typeof memorySchema>;
export const memoryStateSchema = z.object({ enabled: z.boolean(), memories: memorySchema.array() });
export type MemoryState = z.infer<typeof memoryStateSchema>;
export class MemoryError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
// Only a direct instruction at the beginning counts. Quoted examples, questions,
// negations and normal conversation are deliberately not treated as capture.
export function explicitMemoryContent(prompt: string): string | null {
  const match = prompt
    .trim()
    .match(
      /^(?:please\s+)?(?:remember\s+(?:that|this)|save\s+this\s+to\s+memory|keep\s+this\s+in\s+memory)(?=\s|:|$)[\s:]*([\s\S]*)$/i,
    );
  return match ? match[1]!.replace(/\s+/g, " ").trim() : null;
}
export function validVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 8192 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    value.some((n) => n !== 0)
  );
}

export function assertSafeMemory(content: string) {
  if (
    /\b(password|passphrase|api[ _-]?key|access[ _-]?token|private[ _-]?key|secret|credential)\b|\b(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|-----BEGIN|\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./i.test(
      content,
    )
  )
    throw new MemoryError(
      "Passwords, credentials, tokens and secrets cannot be saved as memories.",
    );
}
export const memoryActionSchema = z.object({
  id: z.string(),
  userMessageId: z.string(),
  operation: z.enum(["create", "update", "delete"]),
  targetId: z.string().uuid().nullable(),
  expectedUpdatedAt: z.string().nullable(),
  content: z.string().trim().min(1).max(1000),
  category: z.string().trim().max(80),
  status: z.enum(["pending", "saved", "cancelled"]),
  createdAt: z.string(),
  resultId: z.string().nullable(),
});
export type MemoryAction = z.infer<typeof memoryActionSchema>;
