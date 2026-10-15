import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { AppShell } from "@/components/app-shell";
import { conversations } from "@/lib/conversations";
import type { ConversationSummary } from "@/lib/types";
import type { ReactNode } from "react";
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useSearch: () => ({ conversation: "one" }),
  Link: ({
    to,
    search,
    children,
  }: {
    to: string;
    search?: { conversation?: string };
    children: ReactNode;
  }) => (
    <a href={to + (search?.conversation ? `?conversation=${search.conversation}` : "")}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/conversations", async (original) => ({
  ...(await original<typeof import("@/lib/conversations")>()),
  conversations: { list: vi.fn(), create: vi.fn(), delete: vi.fn(), rename: vi.fn() },
}));
const item: ConversationSummary = {
  id: "one",
  title: "Actual saved conversation",
  createdAt: "now",
  updatedAt: "now",
  modelTag: null,
};
let items: ConversationSummary[];
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  items = [item];
  vi.mocked(conversations.list).mockImplementation(async () => [...items]);
  vi.mocked(conversations.delete).mockImplementation(async (id) => {
    items = items.filter((c) => c.id !== id);
  });
  vi.mocked(conversations.create).mockImplementation(async (id) => {
    const c = { ...item, id, title: "New chat", messages: [] };
    items.push(c);
    return c;
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <AppShell>
        <p>Chat area</p>
      </AppShell>
    </QueryClientProvider>,
  );
}
it("shows real sidebar titles and links to separate conversation IDs", async () => {
  setup();
  const link = await screen.findByRole("link", { name: item.title });
  expect(link).toHaveAttribute("href", "/chat?conversation=one");
  expect(screen.queryByText("Explain quantum computing")).not.toBeInTheDocument();
});
it("opens an unsaved draft when New Chat is clicked", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: /New Chat/ }));
  expect(conversations.create).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(navigate).toHaveBeenCalledWith({
      to: "/chat",
      search: {},
    }),
  );
  expect(items).toHaveLength(1);
});
it("confirms deletion and returns the active conversation to a new empty URL", async () => {
  setup();
  await menu("Delete");
  expect(conversations.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(conversations.delete).not.toHaveBeenCalled();
  await menu("Delete");
  fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/chat", search: {} }));
  expect(items).toEqual([]);
});
it("keeps local storage failures visible", async () => {
  vi.mocked(conversations.list).mockRejectedValue(new Error("Local storage unavailable"));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent("Local storage unavailable");
});

it("renames and immediately refreshes the sidebar only after saving", async () => {
  vi.mocked(conversations.rename).mockImplementation(async (id, title) => {
    items = items.map((c) => (c.id === id ? { ...c, title } : c));
    return { ...items[0]!, messages: [] };
  });
  setup();
  await menu("Rename");
  fireEvent.change(screen.getByRole("textbox", { name: "Conversation title" }), {
    target: { value: "Renamed locally" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save title" }));
  expect(await screen.findByRole("link", { name: "Renamed locally" })).toBeInTheDocument();
  expect(conversations.rename).toHaveBeenCalledWith("one", "Renamed locally");
});

async function menu(action: string) {
  const trigger = await screen.findByRole("button", {
    name: `Conversation options: ${item.title}`,
  });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: action }));
}
it("retains the conversation and confirmation when deletion fails", async () => {
  vi.mocked(conversations.delete).mockRejectedValueOnce(new Error("Disk unavailable"));
  setup();
  await menu("Delete");
  fireEvent.click(screen.getByRole("button", { name: "Delete conversation" }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("alert").some((e) => e.textContent?.includes("Disk unavailable")),
    ).toBe(true),
  );
  expect(items).toHaveLength(1);
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Delete conversation" })).toBeInTheDocument();
});
it("hides truly empty records until the user reviews them", async () => {
  items = [{ ...item, isEmpty: true }];
  setup();
  fireEvent.click(await screen.findByText("Review empty conversations"));
  expect(await screen.findByRole("link", { name: item.title })).toBeInTheDocument();
  expect(conversations.delete).not.toHaveBeenCalled();
});
