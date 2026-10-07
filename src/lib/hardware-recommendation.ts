import { models } from "./mock-data";
import type { HardwareRecommendation } from "./types";

// A conservative estimate, not a benchmark or a guarantee of available RAM/VRAM.
export function recommendHardware(memoryBytes: number): HardwareRecommendation {
  if (!Number.isFinite(memoryBytes) || memoryBytes <= 0) {
    throw new Error("Total system memory could not be detected.");
  }
  const memoryGB = memoryBytes / 2 ** 30;
  const tier = memoryGB < 16 ? "Small" : memoryGB < 32 ? "Medium" : "Large";
  const budgetGB = Math.max(0, memoryGB - Math.max(4, memoryGB * 0.25));
  const preferredId = tier === "Large" ? "qwen-14b" : "qwen-7b";
  const preferred = models.find((model) => model.id === preferredId);
  const modelId = preferred && preferred.memoryGB <= budgetGB ? preferred.id : null;
  const fits = Object.fromEntries(
    models.map((model) => [
      model.id,
      model.memoryGB > budgetGB ? "not-recommended" : model.id === modelId ? "recommended" : "good",
    ]),
  ) as HardwareRecommendation["fits"];

  return {
    tier,
    modelId,
    budgetGB,
    fits,
    reason: modelId
      ? "Memory-based estimate, reserving at least 4 GB or 25% of RAM for your system. Actual speed and GPU acceleration have not been tested."
      : "No suitable model in this catalog leaves enough memory for your system. A smaller model is needed; installation is not available yet.",
  };
}
