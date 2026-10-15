// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConversationRepository } from "./conversations.server";
it("atomically accepts a draft once and rolls back failed first messages", () => {
  const db = new ConversationRepository(":memory:");
  try {
    const id = randomUUID(),
      message = randomUUID();
    expect(() => db.beginTurn(id, message, " ", "local", true)).toThrow();
    expect(db.list()).toEqual([]);
    db.beginTurn(id, message, "Hello", "local", true);
    expect(() => db.beginTurn(id, message, "Hello", "local", true)).toThrow();
    expect(db.list()).toHaveLength(1);
    expect(db.get(id).messages).toHaveLength(2);
    const other = randomUUID();
    expect(() => db.beginTurn(other, message, "Hello", "local", true)).toThrow();
    expect(db.list()).toHaveLength(1);
  } finally {
    db.close();
  }
});
it("classifies emptiness by references and protects changed cleanup candidates", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-drafts-"));
  const db = new ConversationRepository(join(dir, "test.sqlite"));
  try {
    const id = randomUUID();
    db.create(id, null);
    expect(db.list()[0]?.isEmpty).toBe(true);
    db.documents.create(id, "test.txt", new TextEncoder().encode("Test"));
    expect(db.list()[0]?.isEmpty).toBe(false);
    expect(() => db.delete(id, true)).toThrow("no longer empty");
    expect(db.documents.list(id)).toHaveLength(1);
    const empty = randomUUID();
    db.create(empty, null);
    db.delete(empty, true);
    expect(db.list()).toHaveLength(1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
