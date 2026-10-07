import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Route } from "@/routes/index";
import { recommendHardware } from "@/lib/hardware-recommendation";
import type { SystemInfo } from "@/lib/types";

import { modelManager, type ModelAvailability, type InstallProgress } from "@/lib/model-manager";
import { appStore } from "@/lib/store";
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/lib/model-manager", () => ({ modelManager: { check: vi.fn(), install: vi.fn() } }));
const available: ModelAvailability = {
  modelId: "qwen-14b",
  tag: "qwen2.5:14b",
  installed: false,
  installedIds: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  appStore.set({ installed: [], running: null, activeModelId: "qwen-7b" });
  vi.mocked(modelManager.check).mockResolvedValue(available);
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
const Onboarding = Route.options.component as () => ReactNode;
const clients: QueryClient[] = [];

function hardware(memoryGB = 32): SystemInfo {
  return {
    chip: "Apple M4",
    memoryGB,
    memoryBytes: memoryGB * 2 ** 30,
    os: "macOS",
    platform: "Apple Silicon",
    architecture: "ARM64",
    acceleration: "Not checked",
    recommendation: recommendHardware(memoryGB * 2 ** 30),
  };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const result = render(
    <QueryClientProvider client={client}>
      <Onboarding />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Set up Rebel AI" }));
  return result;
}

afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

describe("hardware onboarding", () => {
  it("waits for real data, then carries it into recommendation and model browsing", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            resolve = r;
          }),
      ),
    );
    setup();
    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByText("Apple M2")).not.toBeInTheDocument();
    await act(async () => {
      resolve(Response.json(hardware()));
    });
    await screen.findByText("Apple M4");
    expect(screen.getByText("32 GB memory")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Advanced system information"));
    expect(screen.getByText("ARM64")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Qwen 14B" })).toBeInTheDocument();
    expect(screen.getByText(/Apple M4 • 32 GB memory • Large tier/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Choose another model" }));
    expect(screen.getByRole("button", { name: /Llama 70B/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Qwen 14B/ })).toBeEnabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable error instead of falling back to mocked hardware", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(Response.json(hardware(16))),
    );
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("local Rebel AI server");
    expect(screen.queryByText("Apple M2")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("16 GB memory");
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Qwen 7B" })).toBeInTheDocument();
  });

  it("does not claim a model fits a low-memory computer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(hardware(8))));
    setup();
    await screen.findByText(/No suitable model in this catalog/);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.queryByText("✓ Compatible")).not.toBeInTheDocument();
  });

  it("aborts detection if the user leaves before it completes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const { unmount } = setup();
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});

async function recommendation() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json(hardware())),
  );
  setup();
  await screen.findByText("32 GB memory");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(modelManager.check).toHaveBeenCalledWith("qwen-14b", expect.any(AbortSignal)),
  );
}

describe("real model installation onboarding", () => {
  it("uses an already installed exact recommendation without downloading", async () => {
    vi.mocked(modelManager.check).mockResolvedValue({
      ...available,
      installed: true,
      installedIds: ["qwen-14b"],
    });
    await recommendation();
    const start = await screen.findByRole("button", { name: "Start chatting" });
    fireEvent.click(start);
    expect(navigate).toHaveBeenCalledWith({ to: "/chat" });
    expect(modelManager.install).not.toHaveBeenCalled();
    expect(appStore.get().activeModelId).toBe("qwen-14b");
  });

  it("shows actual progress and only completes after verification", async () => {
    let report!: (progress: InstallProgress) => void;
    let finish!: (model: ModelAvailability) => void;
    vi.mocked(modelManager.install).mockImplementation((_model, onProgress) => {
      report = onProgress;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await recommendation();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Install Model" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Install Model" }));
    act(() =>
      report({
        stage: "download",
        label: "Downloading model — current file",
        completed: 50,
        total: 100,
        percent: 50,
      }),
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(appStore.get().installed).toEqual([]);
    await act(async () => finish({ ...available, installed: true, installedIds: ["qwen-14b"] }));
    expect(await screen.findByText("Installed locally")).toBeInTheDocument();
    expect(appStore.get().activeModelId).toBe("qwen-14b");
  });

  it("cancels the request and ignores late completion", async () => {
    let finish!: (model: ModelAvailability) => void;
    vi.mocked(modelManager.install).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await recommendation();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Install Model" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Install Model" }));
    const signal = vi.mocked(modelManager.install).mock.calls[0]![2];
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ...available, installed: true, installedIds: ["qwen-14b"] }));
    expect(screen.getByRole("alert")).toHaveTextContent("Installation cancelled");
    expect(appStore.get().installed).toEqual([]);
    expect(screen.getByRole("button", { name: "Retry installation" })).toBeEnabled();
  });

  it("allows retry after a download failure", async () => {
    vi.mocked(modelManager.install)
      .mockRejectedValueOnce(new Error("Not enough disk space"))
      .mockResolvedValueOnce({ ...available, installed: true, installedIds: ["qwen-14b"] });
    await recommendation();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Install Model" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Install Model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not enough disk space");
    fireEvent.click(screen.getByRole("button", { name: "Retry installation" }));
    expect(await screen.findByText("Installed locally")).toBeInTheDocument();
  });

  it("blocks installation while Ollama is unavailable and allows checking again", async () => {
    vi.mocked(modelManager.check)
      .mockRejectedValueOnce(new Error("Ollama is not running"))
      .mockResolvedValueOnce(available);
    await recommendation();
    expect(await screen.findByRole("alert")).toHaveTextContent("Ollama is not running");
    expect(screen.getByRole("button", { name: "Install Model" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Install Model" })).toBeEnabled(),
    );
  });
});
