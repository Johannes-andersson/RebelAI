// @vitest-environment node
import { afterEach, beforeEach, expect, it } from "vitest";
import { ConversationRepository } from "./conversations.server";
import { handleMemories } from "./memory-api.server";
let db: ConversationRepository;
beforeEach(() => {
  db = new ConversationRepository(":memory:");
});
afterEach(() => db.close());
const request = (method = "GET", body?: unknown, suffix = "", origin = "http://localhost") =>
  new Request(`http://localhost/api/memories${suffix}`, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
it("lists, disables, re-enables and deletes a memory", async () => {
  const memory = db.memories.create("Fact", null)!;
  expect(await (await handleMemories(request(), undefined, db)).json()).toMatchObject({
    enabled: true,
    memories: [{ id: memory.id }],
  });
  expect(
    await (await handleMemories(request("PATCH", { enabled: false }), undefined, db)).json(),
  ).toMatchObject({ enabled: false });
  await handleMemories(request("PATCH", { enabled: true }), undefined, db);
  expect((await handleMemories(request("DELETE"), memory.id, db)).status).toBe(200);
  expect(db.memories.list()).toEqual([]);
});
it("requires explicit clear confirmation and blocks cross-origin access", async () => {
  db.memories.create("Fact", null);
  expect((await handleMemories(request("DELETE"), undefined, db)).status).toBe(400);
  expect(db.memories.list()).toHaveLength(1);
  expect(
    (
      await handleMemories(
        request("DELETE", undefined, "?confirm=clear", "https://evil.example"),
        undefined,
        db,
      )
    ).status,
  ).toBe(403);
  expect(
    (await handleMemories(request("DELETE", undefined, "?confirm=clear"), undefined, db)).status,
  ).toBe(200);
  expect(db.memories.list()).toEqual([]);
});
it("rejects invalid settings and IDs", async () => {
  expect((await handleMemories(request("PATCH", { enabled: "yes" }), undefined, db)).status).toBe(
    400,
  );
  expect((await handleMemories(request("DELETE"), "bad", db)).status).toBe(400);
});
