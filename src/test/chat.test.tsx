import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { chatRuntime } from "@/lib/runtime";
import { Route } from "@/routes/chat";

import { modelManager } from "@/lib/model-manager";
import { appStore } from "@/lib/store";

vi.mock("@/lib/model-manager", () => ({ modelManager: { list: vi.fn() } }));
const qwen = { id: "qwen-7b", tag: "qwen2.5:7b", name: "Qwen 7B", sizeBytes: 5_000_000_000 };
beforeEach(() => {
  appStore.set({
    installed: ["qwen-7b"],
    installedModels: [qwen],
    activeModelId: "qwen-7b",
    running: "qwen-7b",
  });
  vi.mocked(modelManager.list).mockResolvedValue({ installed: [qwen], supported: [] });
});

vi.mock("@/lib/runtime", () => ({ chatRuntime: { streamReply: vi.fn() } }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, onNewChat }: { children: ReactNode; onNewChat: () => void }) => (
    <div>
      <button onClick={onNewChat}>New Chat</button>
      {children}
    </div>
  ),
}));

const ChatPage = Route.options.component as () => ReactNode;

// jsdom has no element scrolling implementation.
Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });

function send(content: string) {
  fireEvent.change(screen.getByPlaceholderText("Message Rebel AI..."), {
    target: { value: content },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("chat integration", () => {
  it("renders streamed text and passes current conversation context", async () => {
    vi.mocked(chatRuntime.streamReply).mockImplementation(async (_request, onToken) => {
      onToken("Hello ");
      onToken("Sam!");
    });
    render(<ChatPage />);
    send("My name is Sam.");
    await screen.findByText("Hello Sam!");
    await waitFor(() => expect(screen.getByRole("combobox")).not.toBeDisabled());
    send("What is my name?");
    await waitFor(() => expect(chatRuntime.streamReply).toHaveBeenCalledTimes(2));
    expect(vi.mocked(chatRuntime.streamReply).mock.calls[1]![0]).toEqual({
      modelId: "qwen-7b",
      messages: [
        { role: "user", content: "My name is Sam." },
        { role: "assistant", content: "Hello Sam!" },
        { role: "user", content: "What is my name?" },
      ],
    });
  });

  it("shows connection errors and leaves the composer usable", async () => {
    vi.mocked(chatRuntime.streamReply).mockRejectedValue(
      new Error("Cannot connect to Ollama. Open the Ollama app."),
    );
    render(<ChatPage />);
    send("Hello");
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot connect to Ollama");
    expect(screen.queryByText("Thinking…")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Message Rebel AI..."), {
      target: { value: "Try again" },
    });
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("aborts the old request on New Chat and ignores late text and cleanup", async () => {
    let finishOld!: () => void;
    let oldToken!: (text: string) => void;
    vi.mocked(chatRuntime.streamReply)
      .mockImplementationOnce((_request, onToken) => {
        oldToken = onToken;
        return new Promise<void>((resolve) => {
          finishOld = resolve;
        });
      })
      .mockImplementationOnce(() => new Promise<void>(() => {}));
    const { unmount } = render(<ChatPage />);
    send("Old request");
    const oldSignal = vi.mocked(chatRuntime.streamReply).mock.calls[0]![2]!;
    fireEvent.click(screen.getByText("New Chat"));
    expect(oldSignal.aborted).toBe(true);
    send("New request");
    await act(async () => {
      oldToken("Stale reply");
      finishOld();
    });
    expect(screen.queryByText("Stale reply")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeDisabled();
    const currentSignal = vi.mocked(chatRuntime.streamReply).mock.calls[1]![2]!;
    unmount();
    expect(currentSignal.aborted).toBe(true);
  });
});

it("uses an installed model outside the supported catalog in chat", async () => {
  const custom = {
    id: "ollama:custom:latest",
    tag: "custom:latest",
    name: "custom:latest",
    sizeBytes: 123,
  };
  appStore.set({ activeModelId: custom.id, installedModels: [custom], installed: [custom.id] });
  vi.mocked(modelManager.list).mockResolvedValue({ installed: [custom], supported: [] });
  vi.mocked(chatRuntime.streamReply).mockResolvedValue();
  render(<ChatPage />);
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue(custom.id));
  send("Hello custom model");
  await waitFor(() =>
    expect(chatRuntime.streamReply).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: custom.id }),
      expect.any(Function),
      expect.any(AbortSignal),
    ),
  );
});

it("clears a deleted last selection and disables sending", async () => {
  vi.mocked(modelManager.list).mockResolvedValue({ installed: [], supported: [] });
  render(<ChatPage />);
  await screen.findByText("No installed model");
  expect(appStore.get().activeModelId).toBe("");
  fireEvent.change(screen.getByPlaceholderText("Message Rebel AI..."), {
    target: { value: "Hello" },
  });
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  expect(chatRuntime.streamReply).not.toHaveBeenCalled();
});
