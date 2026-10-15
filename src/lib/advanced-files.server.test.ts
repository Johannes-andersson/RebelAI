// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConversationRepository } from "./conversations.server";
import { processDocument } from "./document-processing.server";
import { retrieveDocuments } from "./retrieval.server";
import { relativePath } from "./attachment-config";
import { requireVision, validateImage } from "./image-input.server";
let dir: string, db: ConversationRepository, id: string;
const provider = { model: "test", embed: async (texts: string[]) => texts.map(() => [1, 0]) };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9hoAAAAASUVORK5CYII=",
  "base64",
);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rebel-advanced-"));
  db = new ConversationRepository(join(dir, "test.sqlite"));
  id = randomUUID();
  db.create(id, null);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});
it("imports nested paths, deduplicates retries, and preserves paths through restart", () => {
  const a = db.documents.create(id, "one.txt", Buffer.from("content"), "Folder/Nested/one.txt");
  expect(
    db.documents.create(id, "one.txt", Buffer.from("content"), "Folder/Nested/one.txt").id,
  ).toBe(a.id);
  db.close();
  db = new ConversationRepository(join(dir, "test.sqlite"));
  expect(db.documents.find(a.id).relativePath).toBe("Folder/Nested/one.txt");
  expect(db.documents.list(id)).toHaveLength(1);
});
it.each(["../secret", "/absolute/file", "folder/../../x", "C:\\x", "folder//x", "folder/./x"])(
  "rejects unsafe path %s",
  (path) => {
    expect(() => relativePath(path)).toThrow();
  },
);
it("indexes selected files across conversations while keeping default retrieval isolated", async () => {
  const other = randomUUID();
  db.create(other, null);
  const a = db.documents.create(id, "one.txt", Buffer.from("The payment deadline is March 12."));
  const b = db.documents.create(other, "two.md", Buffer.from("The payment deadline is March 20."));
  await processDocument(db.documents, id, a.id, provider);
  await processDocument(db.documents, other, b.id, provider);
  expect(await retrieveDocuments(db.documents, id, "payment", undefined, provider)).toHaveLength(1);
  expect(
    await retrieveDocuments(db.documents, id, "payment", undefined, provider, [a.id, b.id]),
  ).toHaveLength(2);
  db.documents.rename(id, a.id, "renamed.txt", "Collection/renamed.txt");
  expect(
    (await retrieveDocuments(db.documents, id, "payment", undefined, provider))[0]?.filename,
  ).toBe("renamed.txt");
  await processDocument(db.documents, id, a.id, provider);
  expect(db.documents.chunks(id)).toHaveLength(1);
  db.documents.delete(id, a.id);
  expect(db.documents.get(other, b.id).id).toBe(b.id);
});
it("stores image references on messages across restart without embedding or external calls", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const file = db.documents.create(id, "image.png", png);
  await processDocument(db.documents, id, file.id, provider);
  const message = randomUUID();
  db.beginTurn(id, message, "Describe this image", "local");
  db.documents.attach(message, [file.id]);
  db.saveReply(`${message}:assistant`, "description", "complete");
  db.close();
  db = new ConversationRepository(join(dir, "test.sqlite"));
  expect(db.get(id).messages[0]?.attachments?.[0]?.filename).toBe("image.png");
  expect(db.documents.chunks(id)).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects invalid images and a model that reports no vision", async () => {
  expect(() => validateImage(Buffer.from("not png"), "png")).toThrow();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ capabilities: ["completion"] })),
  );
  await expect(requireVision("text:local", new AbortController().signal)).rejects.toThrow(
    "No image was analyzed",
  );
});
it("accepts a locally reported vision capability and rejects remote models", async () => {
  const fetcher = vi.fn(async () => Response.json({ capabilities: ["completion", "vision"] }));
  vi.stubGlobal("fetch", fetcher);
  await requireVision("vision:local", new AbortController().signal);
  expect(fetcher.mock.calls.length).toBe(2);
  fetcher.mockImplementation(async () =>
    Response.json({ remote_host: "remote.example", capabilities: ["vision"] }),
  );
  await expect(requireVision("vision:local", new AbortController().signal)).rejects.toThrow(
    "locally installed",
  );
});

it("preserves files referenced by another chat when the owning conversation is deleted", async () => {
  const file = db.documents.create(id, "shared.txt", Buffer.from("Project evidence"));
  await processDocument(db.documents, id, file.id, provider);
  const second = randomUUID(),
    message = randomUUID();
  db.create(second, null);
  db.beginTurn(second, message, "Use selected file", "local");
  db.documents.saveSources(
    `${message}:assistant`,
    await retrieveDocuments(db.documents, second, "Project", undefined, provider, [file.id]),
  );
  db.saveReply(`${message}:assistant`, "Evidence", "complete");
  db.delete(id);
  expect(db.documents.find(file.id).conversationId).toBe(second);
  expect(db.documents.storage.exists(file.id)).toBe(true);
  expect(db.get(second).messages[1]?.sources).toHaveLength(1);
});

it("validates duplicate bytes before reuse and accepts portable display filenames", () => {
  const bytes = Buffer.from("duplicate content");
  const file = db.documents.create(id, "Notes.TXT", bytes);
  expect(() => db.documents.create(id, "unsupported.exe", bytes)).toThrow("Unsupported file type");
  expect(() => db.documents.create(id, "invalid.PNG", bytes)).toThrow("image contents");
  expect(db.documents.create(id, "copy.txt", bytes).id).toBe(file.id);
  const windows = db.documents.create(
    id,
    "C:\\Users\\Test\\REPORT.MD",
    Buffer.from("different"),
    "Folder/REPORT.MD",
  );
  expect(windows.filename).toBe("REPORT.MD");
  expect(windows.relativePath).toBe("Folder/REPORT.MD");
});

it("adds file metadata tables to the previous schema without losing originals, excerpts, or history", async () => {
  const file = db.documents.create(id, "legacy.txt", Buffer.from("Legacy project evidence"));
  await processDocument(db.documents, id, file.id, provider);
  const message = randomUUID();
  db.beginTurn(id, message, "Find project evidence", "local");
  db.documents.saveSources(
    `${message}:assistant`,
    await retrieveDocuments(db.documents, id, "project", undefined, provider),
  );
  db.saveReply(`${message}:assistant`, "Legacy reply", "complete");
  db.close();
  const { DatabaseSync } = await import("node:sqlite");
  const legacy = new DatabaseSync(join(dir, "test.sqlite"));
  legacy.exec(
    "DROP TABLE message_attachments; DROP TABLE message_tool_activity; ALTER TABLE documents DROP COLUMN relativePath; ALTER TABLE documents DROP COLUMN contentHash;",
  );
  legacy.close();
  db = new ConversationRepository(join(dir, "test.sqlite"));
  expect(db.documents.get(id, file.id)).toMatchObject({
    filename: "legacy.txt",
    relativePath: "",
    contentHash: null,
    status: "ready",
  });
  expect(db.documents.storage.read(file.id)).toEqual(
    new Uint8Array(Buffer.from("Legacy project evidence")),
  );
  expect(db.get(id).messages[1]).toMatchObject({
    content: "Legacy reply",
    sources: [{ fileId: file.id }],
  });
  db.close();
  db = new ConversationRepository(join(dir, "test.sqlite"));
  expect(db.get(id).messages).toHaveLength(2);
  expect(db.documents.chunks(id)).toHaveLength(1);
});
