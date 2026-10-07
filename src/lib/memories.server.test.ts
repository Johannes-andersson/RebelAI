// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConversationRepository } from "./conversations.server";
let db: ConversationRepository, directory: string, path: string, id: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "rebel-memory-"));
  path = join(directory, "conversations.sqlite");
  db = new ConversationRepository(path);
  id = randomUUID();
  db.create(id, null);
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
it("stores memory in the existing database and survives connection restart", () => {
  const memory = db.memories.create("Rebel AI is my main project.", id)!;
  db.memories.setEmbedding(memory.id, [1, 0], "test", 0);
  const inspect = new DatabaseSync(path);
  expect(inspect.prepare("SELECT content FROM memories").get()?.["content"]).toBe(memory.content);
  inspect.close();
  db.close();
  db = new ConversationRepository(path);
  expect(db.memories.list()).toEqual([memory]);
  expect(db.memories.candidates()[0]?.embedding).toEqual([1, 0]);
  expect(db.get(id).messages).toEqual([]);
  expect(readdirSync(directory).filter((name) => name.endsWith(".sqlite"))).toEqual([
    "conversations.sqlite",
  ]);
});
it("deduplicates explicit saves and survives deleting the source conversation", () => {
  const a = db.memories.create("I prefer TypeScript", id)!;
  expect(db.memories.create("  i prefer   typescript  ", id)?.id).toBe(a.id);
  db.delete(id);
  expect(db.memories.list()[0]).toMatchObject({ id: a.id, sourceConversationId: null });
  expect(db.memories.create("Another fact", id)?.sourceConversationId).toBeNull();
});
it("deletes and clears only memories, preserving conversation and file storage", () => {
  const a = db.memories.create("A", id)!;
  db.memories.create("B", id);
  const message = randomUUID();
  db.beginTurn(id, message, "Hello", "qwen2.5:7b");
  db.saveReply(`${message}:assistant`, "Hi", "complete");
  const file = db.documents.create(id, "sample.txt", new TextEncoder().encode("File content"));
  db.memories.delete(a.id);
  expect(db.memories.list().map((m) => m.content)).toEqual(["B"]);
  db.memories.delete();
  expect(db.memories.list()).toEqual([]);
  expect(db.get(id).messages).toHaveLength(2);
  expect(db.documents.list(id)[0]?.id).toBe(file.id);
});
it("persists disabling and retains memories for re-enabling", () => {
  db.memories.create("Keep me", id);
  db.memories.setEnabled(false);
  expect(db.memories.create("Do not save", id)).toBeNull();
  db.close();
  db = new ConversationRepository(path);
  expect(db.memories.settings().enabled).toBe(false);
  expect(db.memories.list()).toHaveLength(1);
  db.memories.setEnabled(true);
  expect(db.memories.list()[0]?.content).toBe("Keep me");
});
it("skips malformed records and treats malformed vectors as needing repair", () => {
  const good = db.memories.create("Good", id)!;
  const inspect = new DatabaseSync(path);
  inspect.prepare("UPDATE memories SET embedding=? WHERE id=?").run("bad JSON", good.id);
  inspect
    .prepare("INSERT INTO memories VALUES (?,?,?,?,?,?,?,?)")
    .run("bad-id", "Bad", "bad", "now", "now", null, null, null);
  inspect.close();
  expect(db.memories.list()).toHaveLength(1);
  expect(db.memories.candidates()[0]?.embedding).toBeNull();
});
