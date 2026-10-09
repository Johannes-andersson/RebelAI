// @vitest-environment node
import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConversationRepository } from "./conversations.server";
it("lists persisted files across conversations and removes files without mixing histories", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-library-")),
    path = join(dir, "test.sqlite");
  let db = new ConversationRepository(path);
  try {
    const a = randomUUID(),
      b = randomUUID();
    db.create(a, null);
    db.create(b, null);
    const one = db.documents.create(a, "notes.txt", new TextEncoder().encode("One"));
    const two = db.documents.create(b, "notes.md", new TextEncoder().encode("Two"));
    db.close();
    db = new ConversationRepository(path);
    expect(db.documents.library()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: one.id, conversationId: a }),
        expect.objectContaining({ id: two.id, conversationId: b }),
      ]),
    );
    db.documents.delete(a, one.id);
    expect(db.documents.library().map((f) => f.id)).toEqual([two.id]);
    expect(db.documents.storage.exists(one.id)).toBe(false);
    expect(db.get(a).messages).toEqual([]);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
it("marks externally missing originals with an actionable error", () => {
  const dir = mkdtempSync(join(tmpdir(), "rebel-library-"));
  const db = new ConversationRepository(join(dir, "test.sqlite"));
  try {
    const id = randomUUID();
    db.create(id, null);
    const file = db.documents.create(id, "notes.txt", new TextEncoder().encode("One"));
    db.documents.state(file.id, "ready");
    db.documents.storage.remove(file.id);
    expect(db.documents.library()[0]).toMatchObject({
      status: "error",
      error: expect.stringContaining("missing"),
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
