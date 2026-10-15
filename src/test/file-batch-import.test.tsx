import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
import { FileBatchImport } from "@/components/file-batch-import";
import { documents } from "@/lib/documents";
vi.mock("@/lib/documents", () => ({
  documents: { upload: vi.fn(), list: vi.fn(), cancel: vi.fn() },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("imports multiple files sequentially and reports per-file failures", async () => {
  vi.mocked(documents.upload)
    .mockResolvedValueOnce({ id: "a", status: "ready" } as never)
    .mockRejectedValueOnce(new Error("Unsupported file type"));
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <FileBatchImport conversationId="test" />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Upload documents"), {
    target: { files: [new File(["one"], "one.txt"), new File(["two"], "two.exe")] },
  });
  await screen.findByText(/two.exe: Unsupported file type/);
  expect(documents.upload).toHaveBeenCalledTimes(2);
  expect(screen.getByText(/one.txt: Ready/)).toBeInTheDocument();
  client.clear();
});
it("rejects oversized folder counts without uploading", async () => {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <FileBatchImport conversationId="test" />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Import folder"), {
    target: { files: Array.from({ length: 101 }, () => new File(["x"], "x.txt")) },
  });
  await screen.findByText(/Choose at most 100/);
  expect(documents.upload).not.toHaveBeenCalled();
  client.clear();
});
it("cancels an in-flight upload and does not start the remaining files", async () => {
  vi.mocked(documents.upload).mockImplementation(
    (_id, _file, signal) =>
      new Promise((_resolve, reject) =>
        signal?.addEventListener("abort", () => reject(new Error("Cancelled"))),
      ),
  );
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <FileBatchImport conversationId="test" />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByLabelText("Upload documents"), {
    target: { files: [new File(["x"], "a.txt"), new File(["y"], "b.txt")] },
  });
  fireEvent.click(screen.getByText("Cancel import"));
  await waitFor(() => expect(screen.getByText("b.txt: Cancelled")).toBeInTheDocument());
  expect(documents.upload).toHaveBeenCalledTimes(1);
  client.clear();
});

it("accepts dropped files and preserves browser nested paths when selecting a folder", async () => {
  vi.mocked(documents.upload).mockResolvedValue({ id: "a", status: "ready" } as never);
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <FileBatchImport conversationId="test" />
    </QueryClientProvider>,
  );
  const dropped = new File(["drop"], "drop.txt");
  fireEvent.drop(screen.getByRole("region", { name: "Import files" }), {
    dataTransfer: { files: [dropped] },
  });
  await screen.findByText(/drop.txt: Ready/);
  const nested = new File(["nested"], "notes.md");
  Object.defineProperty(nested, "webkitRelativePath", { value: "Folder/Nested/notes.md" });
  fireEvent.change(screen.getByLabelText("Import folder"), { target: { files: [nested] } });
  await screen.findByText(/Folder\/Nested\/notes.md: Ready/);
  expect(documents.upload).toHaveBeenLastCalledWith("test", nested, expect.any(AbortSignal));
  client.clear();
});
