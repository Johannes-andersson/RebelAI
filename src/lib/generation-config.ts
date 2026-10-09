import { z } from "zod";

// Deliberate application limits, not claims about every Ollama model.
export const preferencesSchema = z
  .object({
    mode: z.enum(["automatic", "custom"]),
    temperature: z.number().finite().min(0).max(2).optional(),
    context: z.number().int().min(512).max(32768).optional(),
    maxOutput: z.number().int().min(1).max(8192).optional(),
    topP: z.number().finite().gt(0).max(1).optional(),
  })
  .strict();
export type GenerationPreferences = z.infer<typeof preferencesSchema>;
export const automaticPreferences: GenerationPreferences = { mode: "automatic" };
export const optionsSchema = z
  .object({
    num_ctx: z.number().int().min(512).max(32768),
    num_predict: z.number().int().min(1).max(8192),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().gt(0).max(1).optional(),
  })
  .strict();
export type GenerationOptions = z.infer<typeof optionsSchema>;
export interface GenerationHardware {
  totalBytes: number | null;
  freeBytes: number | null;
}
export function contextRecommendation(
  totalBytes: number | null,
  sizeBytes: number | null,
  modelContext: number | null,
) {
  const gib = 2 ** 30;
  const total = totalBytes && totalBytes > 0 ? totalBytes / gib : null;
  const size = sizeBytes && sizeBytes > 0 ? sizeBytes / gib : null;
  // Reuse onboarding's OS reserve. Disk weights are only a rough RAM proxy.
  const headroom =
    total !== null && size !== null ? total - Math.max(4, total * 0.25) - size * 1.25 : null;
  const hardwareMax =
    headroom === null || headroom < 2
      ? 2048
      : headroom < 4
        ? 4096
        : headroom < 8
          ? 8192
          : headroom < 16
            ? 16384
            : 32768;
  const limit = Math.min(hardwareMax, modelContext ?? 2048, 32768);
  const recommended = Math.min(limit, 8192);
  return {
    limit,
    recommended,
    reason:
      "Conservative RAM estimate: reserve at least 4 GiB or 25% for the system and allow 1.25× model disk size for weights. Context memory varies by architecture; this is not a VRAM measurement or a guarantee.",
  };
}
export function effectiveOptions(
  preferences: GenerationPreferences,
  limit: number,
  recommended: number,
): GenerationOptions {
  const p = preferencesSchema.parse(preferences);
  const custom = p.mode === "custom";
  const context = custom && p.context !== undefined ? p.context : recommended;
  if (context < 512 || context > limit)
    throw new Error(
      `Choose a context window between 512 and ${limit} tokens for this model and computer. Your saved setting has not been changed.`,
    );
  const output =
    custom && p.maxOutput !== undefined ? p.maxOutput : Math.min(1024, Math.floor(context / 4));
  if (output > context - 256)
    throw new Error(
      "Maximum response length must leave at least 256 context tokens for the prompt.",
    );
  return optionsSchema.parse({
    num_ctx: context,
    num_predict: output,
    ...(custom && p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(custom && p.topP !== undefined ? { top_p: p.topP } : {}),
  });
}
export interface PromptMessage {
  role: string;
  content: string;
}
export function fitPrompt(
  messages: PromptMessage[],
  prefixCount: number,
  options: GenerationOptions,
) {
  const prefix = messages.slice(0, prefixCount);
  const history = messages.slice(prefixCount);
  const estimate = (items: PromptMessage[]) =>
    128 +
    items.reduce((n, m) => n + Math.ceil(new TextEncoder().encode(m.content).length / 3) + 12, 0);
  const budget = options.num_ctx - options.num_predict;
  let omittedMessages = 0;
  // Preserve the newest user turn and all application/source context. Drop whole old turns.
  while (estimate([...prefix, ...history]) > budget && history.length > 1) {
    const next = history.findIndex((m, i) => i > 0 && m.role === "user");
    if (next < 0) break;
    history.splice(0, next);
    omittedMessages += next;
  }
  const result = [...prefix, ...history];
  if (estimate(result) > budget)
    throw new Error(
      "This question and its supporting context exceed the estimated prompt budget. Shorten the question, reduce maximum response length, or increase the context window in Model Settings.",
    );
  return { messages: result, estimatedPromptTokens: estimate(result), omittedMessages };
}
export const performanceSchema = z.object({
  modelTag: z.string(),
  elapsedMs: z.number().finite().nonnegative(),
  options: optionsSchema.optional(),
  estimatedPromptTokens: z.number().int().nonnegative().optional(),
  omittedMessages: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  promptTokens: z.number().int().nonnegative().optional(),
  runtimeMs: z.number().finite().nonnegative().optional(),
  tokensPerSecond: z.number().finite().nonnegative().optional(),
});
export type GenerationPerformance = z.infer<typeof performanceSchema>;
export function ollamaMetrics(event: Record<string, unknown>): Partial<GenerationPerformance> {
  if (event["done"] !== true) return {};
  const number = (key: string) =>
    typeof event[key] === "number" && Number.isFinite(event[key]) && event[key] >= 0
      ? (event[key] as number)
      : undefined;
  const count = number("eval_count"),
    duration = number("eval_duration"),
    total = number("total_duration"),
    prompt = number("prompt_eval_count");
  return {
    ...(count !== undefined && Number.isInteger(count) ? { outputTokens: count } : {}),
    ...(prompt !== undefined && Number.isInteger(prompt) ? { promptTokens: prompt } : {}),
    ...(total !== undefined ? { runtimeMs: total / 1e6 } : {}),
    ...(count !== undefined &&
    Number.isInteger(count) &&
    duration &&
    Number.isFinite((count / duration) * 1e9)
      ? { tokensPerSecond: (count / duration) * 1e9 }
      : {}),
  };
}
export const profileSchema = z.object({
  tag: z.string(),
  sizeBytes: z.number().nullable(),
  preferences: preferencesSchema,
  limit: z.number().int(),
  recommended: z.number().int(),
  reason: z.string(),
  modelContext: z.number().nullable(),
  totalBytes: z.number().nullable(),
  freeBytes: z.number().nullable(),
  warning: z.string().nullable(),
  options: optionsSchema.nullable(),
  loaded: z
    .object({ sizeBytes: z.number().nullable(), context: z.number().nullable() })
    .nullable()
    .optional(),
  loadedNotice: z.string().optional(),
});
export type GenerationProfile = z.infer<typeof profileSchema>;
