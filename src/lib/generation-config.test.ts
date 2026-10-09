import { expect, it } from "vitest";
import {
  contextRecommendation,
  effectiveOptions,
  preferencesSchema,
  fitPrompt,
  ollamaMetrics,
} from "./generation-config";
it("keeps sampling defaults untouched in automatic mode and limits output independently", () => {
  expect(effectiveOptions({ mode: "automatic", temperature: 2, topP: 0.1 }, 8192, 4096)).toEqual({
    num_ctx: 4096,
    num_predict: 1024,
  });
  expect(
    effectiveOptions(
      { mode: "custom", temperature: 0, topP: 0.6, context: 2048, maxOutput: 200 },
      8192,
      4096,
    ),
  ).toEqual({ temperature: 0, top_p: 0.6, num_ctx: 2048, num_predict: 200 });
});
it.each([
  { temperature: -1 },
  { temperature: 3 },
  { topP: 0 },
  { topP: 1.1 },
  { context: 0 },
  { context: 65536 },
  { context: 1024.5 },
  { maxOutput: -1 },
  { maxOutput: 9000 },
  { unexpected: 1 },
])("rejects invalid preferences %j", (value) => {
  expect(preferencesSchema.safeParse({ mode: "custom", ...value }).success).toBe(false);
});
it("rejects context/output combinations without silently overwriting explicit settings", () => {
  expect(() => effectiveOptions({ mode: "custom", context: 8192 }, 4096, 2048)).toThrow(
    "has not been changed",
  );
  expect(() =>
    effectiveOptions({ mode: "custom", context: 1024, maxOutput: 1024 }, 4096, 2048),
  ).toThrow("256");
});
it("uses hardware and model limits, falling back conservatively", () => {
  const gib = 2 ** 30;
  expect(contextRecommendation(null, null, null).recommended).toBe(2048);
  expect(contextRecommendation(8 * gib, 4 * gib, 32768).limit).toBe(2048);
  expect(contextRecommendation(32 * gib, 4 * gib, 32768).limit).toBe(32768);
  expect(contextRecommendation(32 * gib, 4 * gib, 4096).limit).toBe(4096);
  expect(contextRecommendation(32 * gib, 4 * gib, null).limit).toBe(2048);
});
it("budgets untrusted source context and output, dropping older whole turns only", () => {
  const prefix = [
    { role: "system", content: "Untrusted search instructions" },
    { role: "user", content: "Untrusted search results" },
  ];
  const old = [
    { role: "user", content: "a".repeat(1200) },
    { role: "assistant", content: "Old answer" },
  ];
  const question = { role: "user", content: "Latest release?" };
  const result = fitPrompt([...prefix, ...old, question], 2, { num_ctx: 512, num_predict: 100 });
  expect(result.messages).toEqual([...prefix, question]);
  expect(result.omittedMessages).toBe(2);
  expect(old).toHaveLength(2);
  expect(() =>
    fitPrompt([{ role: "system", content: "x".repeat(2000) }, question], 1, {
      num_ctx: 512,
      num_predict: 100,
    }),
  ).toThrow("supporting context");
});
it("only reports valid final measured token speed, never character-based estimates", () => {
  expect(
    ollamaMetrics({
      done: true,
      eval_count: 40,
      eval_duration: 2e9,
      total_duration: 3e9,
      prompt_eval_count: 20,
    }),
  ).toEqual({ outputTokens: 40, tokensPerSecond: 20, runtimeMs: 3000, promptTokens: 20 });
  expect(ollamaMetrics({ done: false, eval_count: 40, eval_duration: 2e9 })).toEqual({});
  expect(
    ollamaMetrics({ done: true, eval_count: 40, eval_duration: 0 }).tokensPerSecond,
  ).toBeUndefined();
  expect(ollamaMetrics({ done: true, eval_count: NaN, eval_duration: -1 })).toEqual({});
});
