import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi, afterEach } from "vitest";
import { FileLibrary } from "@/components/file-library";
import { documents } from "@/lib/documents";
import type { ReactNode } from "react";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: ReactNode; search: { conversation: string } }) => (
    <a href={`/chat?conversation=${search.conversation}`}>{children}</a>
  ),
}));
vi.mock("@/hooks/use-conversations", () => ({
  useConversations: () => ({
    recent: { data: [{ id: "one", title: "My documents" }] },
    create: { isPending: false },
  }),
}));
vi.mock("@/lib/documents", () => ({
  documents: {
    library: vi.fn(),
    list: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn(),
    searchStatus: vi.fn(async () => ({ status: "ready", progress: null, error: null })),
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows real files, opens their chat, uploads and removes through existing document APIs", async () => {
  const file = {
    id: "file",
    conversationId: "one",
    filename: "notes.txt",
    type: "txt" as const,
    size: 20,
    createdAt: "2026-10-09",
    status: "ready" as const,
    error: null,
    embeddingModel: "test",
  };
  vi.mocked(documents.library).mockResolvedValue([file]);
  vi.mocked(documents.list).mockResolvedValue([file]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    render(
      <QueryClientProvider client={client}>
        <FileLibrary />
      </QueryClientProvider>,
    );
    await screen.findByText("notes.txt");
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.getByText("Chat with files")).toHaveAttribute("href", "/chat?conversation=one");
    fireEvent.click(screen.getByText("Manage / remove"));
    await screen.findByLabelText("Remove notes.txt");
    fireEvent.click(screen.getByLabelText("Remove notes.txt"));
    await waitFor(() => expect(documents.remove).toHaveBeenCalledWith("one", "file"));
    const upload = new File(["Content"], "new.md");
    await waitFor(() => expect(screen.getByLabelText("Upload document")).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Upload document"), { target: { files: [upload] } });
    await waitFor(() => expect(documents.upload).toHaveBeenCalledWith("one", upload));
  } finally {
    cleanup();
    client.clear();
  }
});
