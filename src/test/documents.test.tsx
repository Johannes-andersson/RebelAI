import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, it, expect, vi } from "vitest";
import { useDocuments } from "@/hooks/use-documents";
import { ConversationDocuments, MessageSources } from "@/components/conversation-documents";
import { documents } from "@/lib/documents";
vi.mock("@/lib/documents", () => ({
  documents: {
    list: vi.fn(),
    upload: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    searchStatus: vi.fn(async () => ({ status: "idle", progress: null, error: null })),
    prepareSearch: vi.fn(),
  },
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function View() {
  const docs = useDocuments("conversation");
  return (
    <>
      <input
        aria-label="Attachment"
        type="file"
        onChange={(e) => {
          if (e.target.files?.[0]) docs.upload(e.target.files[0]);
        }}
      />
      <ConversationDocuments documents={docs} />
    </>
  );
}
it("shows processing/error state and wires upload, retry and removal", async () => {
  vi.mocked(documents.list).mockResolvedValue([
    {
      id: "file",
      conversationId: "conversation",
      filename: "notes.md",
      type: "md",
      size: 10,
      createdAt: "now",
      status: "error",
      error: "Embedding model unavailable",
      embeddingModel: null,
    },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <View />
    </QueryClientProvider>,
  );
  await screen.findByText("notes.md");
  expect(screen.getByText("Embedding model unavailable")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /^Retry$/ }));
  await waitFor(() => expect(documents.retry).toHaveBeenCalledWith("conversation", "file"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Remove notes.md" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove notes.md" }));
  await waitFor(() => expect(documents.remove).toHaveBeenCalledWith("conversation", "file"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Remove notes.md" })).toBeEnabled(),
  );
  const file = new File(["hello"], "note.txt", { type: "text/plain" });
  fireEvent.change(screen.getByLabelText("Attachment"), { target: { files: [file] } });
  await waitFor(() => expect(documents.upload).toHaveBeenCalledWith("conversation", file));
  cleanup();
  client.clear();
});
it("shows saved source filenames and expandable page excerpts without interpreting HTML", () => {
  render(
    <MessageSources
      sources={[
        {
          fileId: "one",
          filename: "notes.pdf",
          page: 2,
          chunkIndex: 0,
          text: "<script>untrusted</script>",
        },
      ]}
    />,
  );
  expect(screen.getByText("Based on: notes.pdf")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Based on: notes.pdf"));
  expect(screen.getByText("notes.pdf · Page 2 · Excerpt 1")).toBeInTheDocument();
  expect(screen.getByText("<script>untrusted</script>")).toBeInTheDocument();
});

it("shows friendly preparation with real progress and no technical command", () => {
  const state = {
    files: [],
    importing: null,
    busy: false,
    error: undefined,
    preparation: {
      status: "preparing" as const,
      progress: { percent: 37, completed: 37, total: 100 },
      error: null,
    },
    upload: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    reload: vi.fn(),
    prepareSearch: vi.fn(),
  };
  render(<ConversationDocuments documents={state} />);
  expect(screen.getByText("Preparing document search…")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "37");
  expect(screen.queryByText(/ollama pull|embeddinggemma/)).not.toBeInTheDocument();
});
it("offers a friendly retry when retrieval discovers an installation failure", () => {
  const retry = vi.fn();
  const state = {
    files: [],
    importing: null,
    busy: false,
    error: undefined,
    preparation: {
      status: "error" as const,
      progress: null,
      error: "The local document-search component could not be installed.",
    },
    upload: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    reload: vi.fn(),
    prepareSearch: retry,
  };
  render(<ConversationDocuments documents={state} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry document search" }));
  expect(retry).toHaveBeenCalledOnce();
});
