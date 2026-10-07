import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MemorySettings } from "@/components/memory-settings";
import { memories } from "@/lib/memories";
vi.mock("@/lib/memories", () => ({
  memories: { list: vi.fn(), setEnabled: vi.fn(), remove: vi.fn(), clear: vi.fn() },
}));
const saved = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  content: "I prefer short answers.",
  createdAt: "now",
  updatedAt: "now",
  sourceConversationId: null,
};
const initial = { enabled: true, memories: [saved] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(memories.list).mockResolvedValue(initial);
});
afterEach(cleanup);
function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemorySettings />
    </QueryClientProvider>,
  );
}
it("lists memories, disables without deleting, and re-enables", async () => {
  setup();
  expect(await screen.findByText(saved.content)).toBeInTheDocument();
  vi.mocked(memories.setEnabled)
    .mockResolvedValueOnce({ ...initial, enabled: false })
    .mockResolvedValueOnce(initial);
  fireEvent.click(screen.getByRole("switch", { name: "Enable memory" }));
  await waitFor(() => expect(memories.setEnabled).toHaveBeenCalledWith(false));
  expect(await screen.findByText(/Memory is off/)).toBeInTheDocument();
  expect(screen.getByText(saved.content)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Enable memory" }));
  await waitFor(() => expect(screen.queryByText(/Memory is off/)).not.toBeInTheDocument());
});
it("deletes an individual memory and shows the empty state", async () => {
  vi.mocked(memories.remove).mockResolvedValue({ enabled: true, memories: [] });
  setup();
  fireEvent.click(await screen.findByRole("button", { name: `Delete memory: ${saved.content}` }));
  expect(await screen.findByText("No saved memories yet.")).toBeInTheDocument();
  expect(memories.remove).toHaveBeenCalledWith(saved.id);
});
it("requires clear-all confirmation and respects cancel", async () => {
  vi.mocked(memories.clear).mockResolvedValue({ enabled: true, memories: [] });
  setup();
  await screen.findByText(saved.content);
  fireEvent.click(screen.getByRole("button", { name: "Clear all memories" }));
  expect(memories.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(memories.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Clear all memories" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear memories" }));
  expect(await screen.findByText("No saved memories yet.")).toBeInTheDocument();
  expect(memories.clear).toHaveBeenCalledOnce();
});
it("shows friendly errors and allows retry", async () => {
  vi.mocked(memories.list)
    .mockRejectedValueOnce(new Error("Could not access saved memories."))
    .mockResolvedValueOnce(initial);
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not access saved memories.");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText(saved.content)).toBeInTheDocument();
});
