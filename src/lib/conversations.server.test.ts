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
