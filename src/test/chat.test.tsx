import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { chatRuntime } from "@/lib/runtime";
import { Route } from "@/routes/chat";

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
