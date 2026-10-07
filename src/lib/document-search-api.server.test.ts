// @vitest-environment node
import { afterEach, it, expect, vi } from "vitest";
import { handleDocumentSearch } from "./document-search-api.server";
import { prepareDocumentSearch, documentSearchStatus } from "./embeddings.server";
vi.mock("./embeddings.server", () => ({
  prepareDocumentSearch: vi.fn(async () => {}),
  documentSearchStatus: vi.fn(() => ({ status: "idle", progress: null, error: null })),
}));
afterEach(() => vi.clearAllMocks());
it("reading progress never installs anything", async () => {
  const response = handleDocumentSearch(new Request("http://localhost/api/document-search"));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: "idle" });
  expect(prepareDocumentSearch).not.toHaveBeenCalled();
});
it("allows a same-origin friendly retry and exposes progress", async () => {
  vi.mocked(documentSearchStatus).mockReturnValueOnce({
    status: "preparing",
    progress: { percent: 25, completed: 25, total: 100 },
    error: null,
  });
  const response = handleDocumentSearch(
    new Request("http://localhost/api/document-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toMatchObject({ progress: { percent: 25 } });
  expect(prepareDocumentSearch).toHaveBeenCalledOnce();
});
it("rejects cross-origin and non-JSON installation requests", () => {
  expect(
    handleDocumentSearch(
      new Request("http://localhost/api/document-search", {
        method: "POST",
        headers: { origin: "https://example.com" },
      }),
    ).status,
  ).toBe(403);
  expect(
    handleDocumentSearch(new Request("http://localhost/api/document-search", { method: "POST" }))
      .status,
  ).toBe(415);
  expect(prepareDocumentSearch).not.toHaveBeenCalled();
});
