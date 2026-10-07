// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationRepository } from "./conversations.server";
import { captureMemory, recallMemories } from "./memory-service.server";
import { explicitMemoryContent } from "./memory-config";
import { requireLocalModel } from "./embeddings.server";
import type { EmbeddingProvider } from "./embeddings.server";
vi.mock("./embeddings.server", () => ({
  requireLocalModel: vi.fn(async () => {}),
  localEmbedder: () => {
    throw new Error("Use test provider");
  },
}));
let db: ConversationRepository;
const signal = () => new AbortController().signal;
const provider: EmbeddingProvider = {
  model: "test",
  embed: async (texts) =>
    texts.map((text) =>
      text.includes("preferences for how")
        ? [0, 1, 0]
        : text.includes("short")
          ? [0, 1, 0]
          : text.includes("irrelevant")
            ? [0, 0, 1]
            : [1, 0, 0],
    ),
};
beforeEach(() => {
  db = new ConversationRepository(":memory:");
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});
it.each([
  "Remember that I like tea",
  "Remember this: I like tea",
  "Save this to memory: I like tea",
  "Keep this in memory I like tea",
  "Please remember that I like tea",
])("recognizes explicit command %s", (command) =>
  expect(explicitMemoryContent(command)).toBe("I like tea"),
);
it.each([
  "I remember that day",
  "Do you remember this?",
  "Explain memory",
  "Remembering is useful",
  "Say 'Remember that I like tea'",
])("does not capture ordinary text %s", (text) => expect(explicitMemoryContent(text)).toBeNull());
it("saves explicit text even when embedding is unavailable", async () => {
  const failing = {
    model: "test",
    embed: vi.fn(async () => {
      throw new Error("offline");
    }),
  };
  expect(
    await captureMemory(() => db.memories, "I like tea", "missing", signal(), failing),
  ).toContain("I’ll remember");
  expect(db.memories.list()[0]?.content).toBe("I like tea");
  expect(await recallMemories(() => db.memories, "tea", "local", signal(), failing)).toBeNull();
  expect(db.memories.list()).toHaveLength(1);
});
it("selects relevant facts and writing preferences but excludes irrelevant memories, capped at three", async () => {
  for (const text of [
    "Project one",
    "Project two",
    "Project three",
    "Project four",
    "irrelevant item",
    "short answers",
  ])
    await captureMemory(() => db.memories, text, "missing", signal(), provider);
  const result = await recallMemories(() => db.memories, "Project", "local", signal(), provider);
  expect(result?.memories).toHaveLength(3);
  expect(result?.memories.some((m) => m.content.includes("irrelevant"))).toBe(false);
  db.memories.delete();
  await captureMemory(() => db.memories, "short answers", "missing", signal(), provider);
  expect(
    (await recallMemories(() => db.memories, "Explain Docker", "local", signal(), provider))
      ?.memories[0]?.content,
  ).toBe("short answers");
});
it("injects nothing for irrelevant records and retries missing embeddings", async () => {
  db.memories.create("irrelevant item", null);
  const result = await recallMemories(() => db.memories, "Project", "local", signal(), provider);
  expect(result?.memories).toEqual([]);
  expect(db.memories.candidates()[0]?.embedding).toEqual([0, 0, 1]);
});
it("does not capture or retrieve while disabled and resumes on re-enable", async () => {
  db.memories.create("Project", null);
  db.memories.setEnabled(false);
  const embed = vi.fn(provider.embed);
  const spy = { ...provider, embed };
  expect(await captureMemory(() => db.memories, "New", "missing", signal(), spy)).toContain(
    "turned off",
  );
  expect(await recallMemories(() => db.memories, "Project", "local", signal(), spy)).toBeNull();
  expect(embed).not.toHaveBeenCalled();
  db.memories.setEnabled(true);
  expect(
    (await recallMemories(() => db.memories, "Project", "local", signal(), spy))?.memories,
  ).toHaveLength(1);
});
it.each(["disable", "clear"])(
  "does not inject or recreate memory if %s happens during embedding",
  async (action) => {
    db.memories.create("Project", null);
    const concurrent = {
      ...provider,
      embed: async (texts: string[]) => {
        if (action === "disable") db.memories.setEnabled(false);
        else db.memories.delete();
        return provider.embed(texts);
      },
    };
    expect(
      await recallMemories(() => db.memories, "Project", "local", signal(), concurrent),
    ).toBeNull();
    if (action === "clear") expect(db.memories.list()).toEqual([]);
  },
);
it("fails open on memory database failure and refuses non-local runtime context", async () => {
  expect(
    await recallMemories(
      () => {
        throw new Error("broken DB");
      },
      "Project",
      "local",
      signal(),
      provider,
    ),
  ).toBeNull();
  db.memories.create("Project", null);
  vi.mocked(requireLocalModel).mockRejectedValueOnce(new Error("cloud runtime"));
  expect(
    await recallMemories(() => db.memories, "Project", "cloud", signal(), provider),
  ).toBeNull();
});
