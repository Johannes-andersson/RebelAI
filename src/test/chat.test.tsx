import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { chatRuntime } from "@/lib/runtime";
import { conversations } from "@/lib/conversations";
import type { Conversation } from "@/lib/types";
import { Route } from "@/routes/chat";
import { modelManager } from "@/lib/model-manager";
import { appStore } from "@/lib/store";
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
vi.mock("@/lib/model-manager", () => ({ modelManager: { list: vi.fn() } }));
vi.mock("@/lib/runtime", () => ({ chatRuntime: { streamReply: vi.fn() } }));
vi.mock("@/lib/conversations", async (original) => ({
  ...(await original<typeof import("@/lib/conversations")>()),
  conversations: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, onNewChat }: { children: ReactNode; onNewChat: () => void }) => (
    <div>
      <button onClick={onNewChat}>New Chat</button>
      {children}
    </div>
  ),
}));
const ChatPage = Route.options.component as () => ReactNode;
const qwen = { id: "qwen-7b", tag: "qwen2.5:7b", name: "Qwen 7B", sizeBytes: 123 };
const llama = { id: "llama-8b", tag: "llama3.1:8b", name: "Llama 8B", sizeBytes: 123 };
const records = new Map<string, Conversation>();
const clients: QueryClient[] = [];
let currentId: string | undefined;
const empty = (id: string): Conversation => ({
  id,
  title: "New chat",
  modelTag: qwen.tag,
  createdAt: "2026-10-07",
  updatedAt: "2026-10-07",
  messages: [],
});
function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ChatPage />, { wrapper });
}
async function ready() {
  await waitFor(() => expect(screen.queryByText("Loading conversation…")).not.toBeInTheDocument());
}
function send(content: string) {
  fireEvent.change(screen.getByPlaceholderText("Message Rebel AI..."), {
    target: { value: content },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}
beforeEach(() => {
  vi.clearAllMocks();
  records.clear();
  currentId = "one";
  records.set("one", empty("one"));
  records.set("two", empty("two"));
  vi.spyOn(Route, "useSearch").mockImplementation(() =>
    currentId ? { conversation: currentId } : {},
  );
  appStore.set({
    installed: [qwen.id, llama.id],
    installedModels: [qwen, llama],
    activeModelId: qwen.id,
    running: qwen.id,
  });
  vi.mocked(modelManager.list).mockResolvedValue({ installed: [qwen, llama], supported: [] });
  vi.mocked(conversations.get).mockImplementation(async (id) =>
    JSON.parse(JSON.stringify(records.get(id))),
  );
  vi.mocked(conversations.create).mockImplementation(async (id) => {
    const c = empty(id);
    records.set(id, c);
    return c;
  });
  vi.mocked(conversations.update).mockImplementation(async (id, tag) => {
    const c = { ...records.get(id)!, modelTag: tag };
    records.set(id, c);
    return c;
  });
  vi.mocked(chatRuntime.streamReply).mockImplementation(async (request, onToken) => {
    const c = records.get(request.conversationId)!;
    const fields = { conversationId: c.id, createdAt: "now", status: "complete" as const };
    c.messages.push({ ...fields, id: request.messageId, role: "user", content: request.content });
    onToken("Hello ");
    onToken("Sam!");
    c.messages.push({
      ...fields,
      id: `${request.messageId}:assistant`,
      role: "assistant",
      content: "Hello Sam!",
    });
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
});
Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });

describe("persistent chat UI", () => {
  it("renders streamed text and sends a durable conversation/message reference", async () => {
    view();
    await ready();
    send("My name is Sam.");
    await screen.findByText("Hello Sam!");
    await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
    send("What is my name?");
    await waitFor(() => expect(chatRuntime.streamReply).toHaveBeenCalledTimes(2));
    expect(vi.mocked(chatRuntime.streamReply).mock.calls[1]![0]).toMatchObject({
      conversationId: "one",
      modelId: qwen.id,
      content: "What is my name?",
      messageId: expect.any(String),
    });
  });
  it("reopens full saved history after remounting with a new query cache", async () => {
    const { unmount } = view();
    await ready();
    send("Remember this locally");
    await screen.findByText("Hello Sam!");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stop generating" })).not.toBeInTheDocument(),
    );
    unmount();
    view();
    await ready();
    expect(screen.getByText("Remember this locally")).toBeInTheDocument();
    expect(screen.getByText("Hello Sam!")).toBeInTheDocument();
    expect(conversations.create).not.toHaveBeenCalled();
  });
  it("aborts when switching conversations and ignores late text", async () => {
    let finish!: () => void;
    let token!: (text: string) => void;
    vi.mocked(chatRuntime.streamReply).mockImplementationOnce((_request, onToken) => {
      token = onToken;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const page = view();
    await ready();
    send("Old request");
    const signal = vi.mocked(chatRuntime.streamReply).mock.calls[0]![2]!;
    fireEvent.click(screen.getByText("New Chat"));
    currentId = "two";
    page.rerender(<ChatPage />);
    await ready();
    expect(signal.aborted).toBe(true);
    await act(async () => {
      token("Stale reply");
      finish();
    });
    expect(screen.queryByText("Old request")).not.toBeInTheDocument();
    expect(screen.queryByText("Stale reply")).not.toBeInTheDocument();
    send("Separate request");
    await screen.findByText("Hello Sam!");
    expect(vi.mocked(chatRuntime.streamReply).mock.calls[1]![0].conversationId).toBe("two");
  });
  it("restores the conversation model and saves explicit model changes", async () => {
    records.get("one")!.modelTag = llama.tag;
    view();
    await ready();
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(llama.id));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: qwen.id } });
    await waitFor(() => expect(conversations.update).toHaveBeenCalledWith("one", qwen.tag));
    expect(records.get("one")!.modelTag).toBe(qwen.tag);
  });
  it("creates an empty record when opening a new chat URL", async () => {
    currentId = undefined;
    view();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: "/chat",
        search: { conversation: expect.any(String) },
        replace: true,
      }),
    );
    expect(conversations.create).toHaveBeenCalledTimes(1);
  });
  it("keeps an interrupted reply visibly incomplete", async () => {
    records.get("one")!.messages.push({
      id: "partial",
      conversationId: "one",
      role: "assistant",
      content: "Partial text",
      createdAt: "now",
      status: "interrupted",
    });
    view();
    await ready();
    expect(screen.getByText(/Partial text/)).toBeInTheDocument();
    expect(screen.getByText(/Incomplete reply/)).toBeInTheDocument();
  });
  it("requires selecting a replacement when the stored model has been removed", async () => {
    records.get("one")!.modelTag = "removed:latest";
    view();
    await ready();
    await screen.findByText(/saved model removed:latest/);
    fireEvent.change(screen.getByPlaceholderText("Message Rebel AI..."), {
      target: { value: "Hello" },
    });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeEnabled();
  });
});

it("opens saved history while Ollama is unavailable without calling the model missing", async () => {
  records
    .get("one")!
    .messages.push({
      id: "saved",
      conversationId: "one",
      role: "user",
      content: "Saved offline history",
      createdAt: "now",
      status: "complete",
    });
  vi.mocked(modelManager.list).mockRejectedValueOnce(new Error("Ollama is not responding"));
  view();
  await ready();
  expect(screen.getByText("Saved offline history")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Ollama is not responding");
  expect(screen.queryByText(/saved model .* is not installed/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reload history" }));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
});
it("retries failed conversation creation with the same ID", async () => {
  currentId = undefined;
  vi.mocked(conversations.create).mockRejectedValueOnce(new Error("Local storage unavailable"));
  view();
  await screen.findByText(/Local storage unavailable/);
  fireEvent.click(screen.getByRole("button", { name: "Reload history" }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());
  expect(vi.mocked(conversations.create).mock.calls[0]![0]).toBe(
    vi.mocked(conversations.create).mock.calls[1]![0],
  );
});
it("preserves error feedback when generation fails and allows another message", async () => {
  vi.mocked(chatRuntime.streamReply).mockRejectedValueOnce(new Error("Ollama is unavailable"));
  view();
  await ready();
  send("Hello");
  expect(await screen.findByRole("alert")).toHaveTextContent("Ollama is unavailable");
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  fireEvent.change(screen.getByPlaceholderText("Message Rebel AI..."), {
    target: { value: "Retry" },
  });
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
});
