// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConversationRepository, conversationTitle } from "./conversations.server";
let dir: string;
let db: ConversationRepository;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rebel-history-"));
  db = new ConversationRepository(join(dir, "test.sqlite"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
describe("local conversation storage", () => {
  it("creates, updates, loads and deletes a conversation and all messages", () => {
    const id = randomUUID();
    expect(db.create(id, "qwen2.5:7b")).toMatchObject({
      id,
      title: "New chat",
      messages: [],
      modelTag: "qwen2.5:7b",
    });
    db.update(id, "llama3.1:8b");
    const message = randomUUID();
    db.beginTurn(id, message, "  Hello\n  local history  ", "llama3.1:8b");
    db.saveReply(`${message}:assistant`, "Hello!", "complete");
    expect(db.get(id)).toMatchObject({
      title: "Hello local history",
      modelTag: "llama3.1:8b",
      messages: [{ role: "user" }, { content: "Hello!", status: "complete" }],
    });
    db.delete(id);
    expect(db.list()).toEqual([]);
    expect(() => db.get(id)).toThrow("no longer exists");
    db.create(id, null);
    expect(db.get(id).messages).toEqual([]);
  });
  it("survives a closed connection and restart, recovering unfinished replies", () => {
    const id = randomUUID();
    const first = randomUUID();
    db.create(id, "qwen2.5:7b");
    db.beginTurn(id, first, "First", "qwen2.5:7b");
    db.saveReply(`${first}:assistant`, "Complete answer", "complete");
    const second = randomUUID();
    db.beginTurn(id, second, "Second", "qwen2.5:7b");
    db.saveReply(`${second}:assistant`, "Partial", "pending");
    db.close();
    db = new ConversationRepository(join(dir, "test.sqlite"));
    expect(db.get(id).messages.map((m) => [m.content, m.status])).toEqual([
      ["First", "complete"],
      ["Complete answer", "complete"],
      ["Second", "complete"],
      ["Partial", "interrupted"],
    ]);
  });
  it("isolates histories and only titles from the first user message", () => {
    const a = randomUUID(),
      b = randomUUID(),
      m = randomUUID();
    db.create(a, null);
    db.create(b, null);
    db.beginTurn(a, m, "A title", "a:latest");
    db.saveReply(`${m}:assistant`, "A answer", "complete");
    db.beginTurn(a, randomUUID(), "Do not replace title", "b:latest");
    expect(db.get(a).title).toBe("A title");
    expect(db.get(b).messages).toEqual([]);
  });
  it("rejects overlapping generations and duplicate sends without adding messages", () => {
    const id = randomUUID(),
      m = randomUUID();
    db.create(id, null);
    db.beginTurn(id, m, "Hello", "model");
    expect(() => db.beginTurn(id, randomUUID(), "Other", "model")).toThrow(
      "already being generated",
    );
    expect(db.get(id).messages).toHaveLength(2);
    db.saveReply(`${m}:assistant`, "Done", "complete");
    expect(() => db.beginTurn(id, m, "Hello", "model")).toThrow("already saved");
    expect(db.get(id).messages).toHaveLength(2);
  });
  it("does not resurrect a conversation deleted during generation", () => {
    const id = randomUUID(),
      m = randomUUID();
    db.create(id, null);
    db.beginTurn(id, m, "Hello", "model");
    db.delete(id);
    expect(() => db.saveReply(`${m}:assistant`, "Late", "complete")).toThrow("no longer active");
    expect(db.list()).toEqual([]);
  });
  it("makes creation retries idempotent", () => {
    const id = randomUUID();
    const original = db.create(id, "model");
    expect(db.create(id, null)).toEqual(original);
    expect(db.list()).toHaveLength(1);
  });
  it("generates compact Unicode-safe titles", () => {
    expect(conversationTitle(" \n Hello    world\t ")).toBe("Hello world");
    expect(conversationTitle("😀".repeat(65))).toBe("😀".repeat(59) + "…");
  });
});

it("regenerates only the latest reply atomically without duplicating its user", () => {
  const id = randomUUID(),
    user = randomUUID();
  db.create(id, "local:tag");
  db.beginTurn(id, user, "Original", "local:tag");
  db.saveReply(`${user}:assistant`, "Old", "complete");
  const next = randomUUID();
  const result = db.reviseTurn(
    id,
    next,
    { kind: "regenerate", userMessageId: user, expectedTailId: `${user}:assistant` },
    "ignored",
    "local:tag",
  );
  expect(result.messages.map((m) => [m.id, m.content, m.status])).toEqual([
    [user, "Original", "complete"],
    [`${next}:assistant`, "", "pending"],
  ]);
  expect(() =>
    db.reviseTurn(
      id,
      randomUUID(),
      { kind: "regenerate", userMessageId: user, expectedTailId: `${next}:assistant` },
      "Original",
      "local:tag",
    ),
  ).toThrow("already being generated");
  expect(() => db.saveReply(`${user}:assistant`, "Stale token", "complete")).toThrow(
    "no longer active",
  );
});
it("editing earlier history removes downstream messages and citations and survives restart", () => {
  const id = randomUUID(),
    other = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  db.create(id, "local:tag");
  db.create(other, "local:tag");
  for (const user of [first, second]) {
    db.beginTurn(id, user, user === first ? "First prompt" : "Later prompt", "local:tag");
    db.saveReply(`${user}:assistant`, "Old", "complete");
    db.internet.save(`${user}:assistant`, {
      status: "complete",
      notice: "Sources",
      sources: [{ id: "S1", title: "Source", url: "https://example.org", snippet: "Old evidence" }],
    });
  }
  const next = randomUUID();
  db.reviseTurn(
    id,
    next,
    { kind: "edit", userMessageId: first, expectedTailId: `${second}:assistant` },
    "Edited prompt",
    "local:tag",
  );
  db.saveReply(`${next}:assistant`, "New reply", "complete");
  expect(db.internet.get(`${second}:assistant`)).toBeUndefined();
  expect(db.internet.get(`${first}:assistant`)).toBeUndefined();
  db.close();
  db = new ConversationRepository(join(dir, "test.sqlite"));
  expect(db.get(id).messages.map((m) => m.content)).toEqual(["Edited prompt", "New reply"]);
  expect(db.get(id).title).toBe("Edited prompt");
  expect(db.get(other).messages).toEqual([]);
});
it("rejects stale, foreign and non-latest regeneration without changing history", () => {
  const id = randomUUID(),
    first = randomUUID(),
    second = randomUUID();
  db.create(id, "local:tag");
  for (const user of [first, second]) {
    db.beginTurn(id, user, "Prompt", "local:tag");
    db.saveReply(`${user}:assistant`, "Reply", "complete");
  }
  const before = db.get(id);
  for (const [userMessageId, expectedTailId] of [
    [first, `${second}:assistant`],
    [second, `${first}:assistant`],
    [randomUUID(), `${second}:assistant`],
  ]) {
    expect(() =>
      db.reviseTurn(
        id,
        randomUUID(),
        { kind: "regenerate", userMessageId: userMessageId!, expectedTailId: expectedTailId! },
        "Prompt",
        "local:tag",
      ),
    ).toThrow();
    expect(db.get(id)).toEqual(before);
  }
});
it("manual titles survive first messages, edits, and restarts; invalid titles do not save", () => {
  const id = randomUUID(),
    user = randomUUID();
  db.create(id, "local:tag");
  db.rename(id, "  My custom title  ");
  db.beginTurn(id, user, "Automatic title", "local:tag");
  db.saveReply(`${user}:assistant`, "Old", "complete");
  const next = randomUUID();
  db.reviseTurn(
    id,
    next,
    { kind: "edit", userMessageId: user, expectedTailId: `${user}:assistant` },
    "Changed first message",
    "local:tag",
  );
  expect(() => db.rename(id, " ")).toThrow();
  expect(() => db.rename(id, "x".repeat(101))).toThrow();
  db.close();
  db = new ConversationRepository(join(dir, "test.sqlite"));
  expect(db.get(id).title).toBe("My custom title");
  expect(db.get(id).messages.at(-1)?.status).toBe("interrupted");
});
it("deleting during replacement prevents any later checkpoint from resurrecting it", () => {
  const id = randomUUID(),
    user = randomUUID(),
    next = randomUUID();
  db.create(id, "local:tag");
  db.beginTurn(id, user, "Hello", "local:tag");
  db.saveReply(`${user}:assistant`, "Old", "complete");
  db.reviseTurn(
    id,
    next,
    { kind: "regenerate", userMessageId: user, expectedTailId: `${user}:assistant` },
    "Hello",
    "local:tag",
  );
  db.delete(id);
  expect(() => db.saveReply(`${next}:assistant`, "Late", "complete")).toThrow();
  expect(db.list()).toEqual([]);
});
it("migrates an old database without losing its existing conversation", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const path = join(dir, "legacy.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(
    "CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, modelTag TEXT)",
  );
  const id = randomUUID();
  legacy
    .prepare("INSERT INTO conversations VALUES (?, 'Legacy title', 'then', 'then', NULL)")
    .run(id);
  legacy.close();
  const migrated = new ConversationRepository(path);
  try {
    expect(migrated.get(id).title).toBe("Legacy title");
    migrated.rename(id, "Kept title");
    expect(migrated.create(randomUUID(), null).messages).toEqual([]);
  } finally {
    migrated.close();
  }
});
it("edits the latest user while retaining all preceding turns and the selected model", () => {
  const id = randomUUID(),
    first = randomUUID(),
    last = randomUUID();
  db.create(id, "local:tag");
  for (const user of [first, last]) {
    db.beginTurn(id, user, "Prompt", "local:tag");
    db.saveReply(`${user}:assistant`, "Reply", "complete");
  }
  const previous = db.get(id).messages.slice(0, 2);
  const revision = {
    kind: "edit" as const,
    userMessageId: last,
    expectedTailId: `${last}:assistant`,
  };
  expect(() => db.reviseTurn(id, randomUUID(), revision, "Changed", "other:tag")).toThrow(
    "selected model changed",
  );
  const result = db.reviseTurn(id, randomUUID(), revision, "Changed", "local:tag");
  expect(result.modelTag).toBe("local:tag");
  expect(result.messages.slice(0, 2)).toEqual(previous);
  expect(result.messages[2]?.content).toBe("Changed");
  expect(result.messages).toHaveLength(4);
});
