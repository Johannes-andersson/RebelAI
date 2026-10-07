// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConversationRepository } from "./conversations.server";
import { handleConversations } from "./conversation-api.server";
let db: ConversationRepository;
beforeEach(() => {
  db = new ConversationRepository(":memory:");
});
afterEach(() => db.close());
const request = (method: string, body?: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/conversations", {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
it("supports create, list, get, update and delete over the local API", async () => {
  const id = randomUUID();
  expect(
    (await handleConversations(request("POST", { id, modelTag: "test:latest" }), undefined, db))
      .status,
  ).toBe(200);
  const list = await handleConversations(request("GET"), undefined, db);
  expect(await list.json()).toHaveLength(1);
  const update = await handleConversations(request("PATCH", { modelTag: "other:latest" }), id, db);
  expect((await update.json()).modelTag).toBe("other:latest");
  expect((await handleConversations(request("GET"), id, db)).status).toBe(200);
  expect((await handleConversations(request("DELETE"), id, db)).status).toBe(204);
  expect((await handleConversations(request("GET"), id, db)).status).toBe(404);
});
it("rejects foreign origins and malformed IDs without changing storage", async () => {
  expect(
    (
      await handleConversations(
        request("POST", { id: randomUUID() }, "https://other.test"),
        undefined,
        db,
      )
    ).status,
  ).toBe(403);
  expect((await handleConversations(request("GET"), "invalid", db)).status).toBe(400);
  expect(
    (await handleConversations(request("POST", { id: "invalid" }), undefined, db)).status,
  ).toBe(400);
  expect(db.list()).toEqual([]);
});
it("does not expose database details in storage errors", async () => {
  db.close();
  const result = await handleConversations(request("GET"), undefined, db);
  expect(result.status).toBe(500);
  expect((await result.json()).error).toContain("data-folder permissions");
  db = new ConversationRepository(":memory:");
});
