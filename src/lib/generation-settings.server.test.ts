// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConversationRepository } from "./conversations.server";
it("persists independent model preferences across restart and resets only one model", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-settings-"));
  let db = new ConversationRepository(join(dir, "test.sqlite"));
  try {
    expect(db.generation.get("a")).toEqual({ mode: "automatic" });
    db.generation.set("a", { mode: "custom", temperature: 0.2, context: 2048 });
    db.generation.set("b:7b", { mode: "custom", temperature: 1.2 });
    db.close();
    db = new ConversationRepository(join(dir, "test.sqlite"));
    expect(db.generation.get("a:latest").temperature).toBe(0.2);
    expect(db.generation.get("b:7b").temperature).toBe(1.2);
    db.generation.set("a", { mode: "automatic", temperature: 0.2 });
    expect(db.generation.get("a")).toEqual({ mode: "automatic" });
    expect(db.generation.get("b:7b").temperature).toBe(1.2);
    // Preferences do not depend on inventory or a conversation foreign key.
    expect(db.list()).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("stores performance atomically with replies, preserves on restart, and cascades deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-performance-"));
  let db = new ConversationRepository(join(dir, "test.sqlite"));
  const id = randomUUID(),
    turn = randomUUID();
  try {
    db.create(id, "a:latest");
    db.beginTurn(id, turn, "Hello", "a:latest");
    const performance = { modelTag: "a:latest", elapsedMs: 2000, tokensPerSecond: 20 };
    db.saveReply(`${turn}:assistant`, "Answer", "complete", performance);
    db.close();
    db = new ConversationRepository(join(dir, "test.sqlite"));
    expect(db.get(id).messages[1]?.performance).toEqual(performance);
    expect(db.get(id).messages[0]?.performance).toBeUndefined();
    db.delete(id);
    expect(db.generation.performance(`${turn}:assistant`)).toBeUndefined();
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
