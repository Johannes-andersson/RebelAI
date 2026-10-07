// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ConversationRepository } from "./conversations.server";
import { handleDocuments } from "./document-api.server";
import { startDocumentJob } from "./document-processing.server";
vi.mock("./document-processing.server", () => ({
  startDocumentJob: vi.fn(),
  cancelDocumentJob: vi.fn(),
}));
let directory: string, repo: ConversationRepository, id: string;
const request = (method: string, headers: Record<string, string> = {}, body?: string) =>
  new Request("http://localhost/api/conversations/documents", {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "rebel-doc-api-"));
  repo = new ConversationRepository(join(directory, "db.sqlite"));
  id = randomUUID();
  repo.create(id, null);
});
afterEach(() => {
  repo.close();
  rmSync(directory, { recursive: true, force: true });
  vi.clearAllMocks();
});
it("uploads, lists, retries and removes attachments through local endpoints", async () => {
  const response = await handleDocuments(
    request(
      "POST",
      { "content-type": "application/octet-stream", "x-file-name": "notes.md" },
      "# Notes",
    ),
    id,
    undefined,
    repo,
  );
  expect(response.status).toBe(200);
  const file = await response.json();
  expect(startDocumentJob).toHaveBeenCalledWith(repo.documents, id, file.id);
  expect(await (await handleDocuments(request("GET"), id, undefined, repo)).json()).toMatchObject([
    { filename: "notes.md" },
  ]);
  expect(
    (
      await handleDocuments(
        request("POST", { "content-type": "application/json" }, "{}"),
        id,
        file.id,
        repo,
      )
    ).status,
  ).toBe(200);
  expect((await handleDocuments(request("DELETE"), id, file.id, repo)).status).toBe(204);
  expect(repo.documents.list(id)).toEqual([]);
});
it("rejects cross-origin, unsupported and oversized uploads", async () => {
  expect(
    (await handleDocuments(request("GET", { origin: "https://evil.test" }), id, undefined, repo))
      .status,
  ).toBe(403);
  expect(
    (
      await handleDocuments(
        request(
          "POST",
          { "content-type": "application/octet-stream", "x-file-name": "data.docx" },
          "data",
        ),
        id,
        undefined,
        repo,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await handleDocuments(
        request(
          "POST",
          {
            "content-type": "application/octet-stream",
            "x-file-name": "data.txt",
            "content-length": "999999999",
          },
          "data",
        ),
        id,
        undefined,
        repo,
      )
    ).status,
  ).toBe(413);
  expect(repo.documents.list(id)).toEqual([]);
});
it("cannot remove an attachment associated with another conversation", async () => {
  const file = repo.documents.create(id, "notes.txt", new TextEncoder().encode("hi"));
  const other = randomUUID();
  repo.create(other, null);
  expect((await handleDocuments(request("DELETE"), other, file.id, repo)).status).toBe(404);
  expect(repo.documents.storage.exists(file.id)).toBe(true);
});
