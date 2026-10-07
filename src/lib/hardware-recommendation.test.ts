import { describe, expect, it } from "vitest";
import { recommendHardware } from "./hardware-recommendation";

const GiB = 2 ** 30;

describe("hardware recommendations", () => {
  it.each([
    [8, "Small", null, 4],
    [12, "Small", "qwen-7b", 8],
    [16, "Medium", "qwen-7b", 12],
    [24, "Medium", "qwen-7b", 18],
    [32, "Large", "qwen-14b", 24],
    [64, "Large", "qwen-14b", 48],
    [128, "Large", "qwen-14b", 96],
  ])("maps %s GB to %s with room for the OS", (memory, tier, modelId, budgetGB) => {
    expect(recommendHardware(memory * GiB)).toMatchObject({ tier, modelId, budgetGB });
  });

  it("uses raw memory rather than rounding up at tier boundaries", () => {
    expect(recommendHardware(16 * GiB - 1).tier).toBe("Small");
    expect(recommendHardware(32 * GiB - 1).tier).toBe("Medium");
    expect(recommendHardware(12 * GiB - 1).modelId).toBeNull();
  });

  it("does not reuse the static catalog fit badges", () => {
    expect(recommendHardware(16 * GiB).fits).toEqual({
      "qwen-7b": "recommended",
      "llama-8b": "good",
      "gemma-9b": "good",
      "qwen-14b": "not-recommended",
      "llama-70b": "not-recommended",
    });
    expect(recommendHardware(32 * GiB).fits["qwen-14b"]).toBe("recommended");
  });

  it.each([0, -1, NaN, Infinity])("rejects missing or invalid memory: %s", (memory) => {
    expect(() => recommendHardware(memory)).toThrow("could not be detected");
  });
});
