// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ConversationRepository } from "./conversations.server";
import { handleInternet } from "./internet-api.server";
let db: ConversationRepository, dir: string, path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rebel-internet-"));
  path = join(dir, "conversations.sqlite");
  db = new ConversationRepository(path);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const req = (method = "GET", body?: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/internet", {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
it("defaults off and persists permission across restarts without changing memories/history", async () => {
  expect(db.internet.enabled()).toBe(false);
  const id = randomUUID();
  db.create(id, null);
  db.memories.setEnabled(false);
  expect(await (await handleInternet(req("PATCH", { enabled: true }), db)).json()).toEqual({
    enabled: true,
  });
  db.close();
  db = new ConversationRepository(path);
  expect(await (await handleInternet(req(), db)).json()).toEqual({ enabled: true });
  expect(db.memories.settings().enabled).toBe(false);
  expect(db.get(id).messages).toEqual([]);
});
it("turning off aborts active searches and refuses new leases", () => {
  db.internet.setEnabled(true);
  const lease = db.internet.beginSearch(new AbortController().signal)!;
  db.internet.setEnabled(false);
  expect(lease.signal.aborted).toBe(true);
  expect(db.internet.beginSearch(new AbortController().signal)).toBeNull();
  lease.finish();
  db.internet.setEnabled(true);
  expect(lease.signal.aborted).toBe(true);
});
it("rejects cross-origin writes, invalid flags and browser-only claims", async () => {
  expect(
    (await handleInternet(req("PATCH", { enabled: true }, "https://other.example"), db)).status,
  ).toBe(403);
  expect((await handleInternet(req("PATCH", { enabled: "true" }), db)).status).toBe(400);
  expect(db.internet.enabled()).toBe(false);
});
it("persists sources separately and cascades their deletion with the conversation", () => {
  const id = randomUUID(),
    message = randomUUID();
  db.create(id, null);
  db.beginTurn(id, message, "latest news", "qwen2.5:7b");
  const state = {
    status: "complete" as const,
    notice: "Web sources",
    sources: [{ id: "S1", title: "Source", url: "https://example.org/news", snippet: "A result" }],
  };
  db.internet.save(`${message}:assistant`, state);
  db.saveReply(`${message}:assistant`, "Answer", "complete");
  db.close();
  db = new ConversationRepository(path);
  expect(db.get(id).messages[1]?.webSearch).toEqual(state);
  expect(db.get(id).messages[0]?.content).toBe("latest news");
  db.delete(id);
  expect(db.internet.get(`${message}:assistant`)).toBeUndefined();
});
