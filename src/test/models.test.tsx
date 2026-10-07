import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Route } from "@/routes/models";
import {
  modelManager,
  type ModelInventory,
  type InstalledModel,
  type ModelAvailability,
} from "@/lib/model-manager";
import { appStore } from "@/lib/store";
vi.mock("@/lib/model-manager", () => ({
  modelManager: { list: vi.fn(), check: vi.fn(), install: vi.fn(), remove: vi.fn() },
}));
vi.mock("@/hooks/use-system-info", () => ({
  useSystemInfo: () => ({
    data: {
      chip: "Test CPU",
      memoryGB: 16,
      recommendation: { tier: "Medium", fits: { "qwen-7b": "recommended", "llama-8b": "good" } },
    },
  }),
}));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title, right }: { title: string; right: ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {right}
    </header>
  ),
}));
const ModelsPage = Route.options.component as () => ReactNode;
const qwen: InstalledModel = {
  id: "qwen-7b",
  tag: "qwen2.5:7b",
  name: "Qwen 7B",
  sizeBytes: 4_000_000_000,
};
const custom: InstalledModel = {
  id: "ollama:my/custom:latest",
  tag: "my/custom:latest",
  name: "my/custom:latest",
  sizeBytes: 123_000_000,
};
const llama: ModelAvailability = {
  modelId: "llama-8b",
  tag: "llama3.1:8b",
  installed: false,
  installedIds: ["qwen-7b"],
};
const base: ModelInventory = { installed: [qwen, custom], supported: [llama] };
const row = (name: string) =>
  within(screen.getAllByText(name)[0]!.closest(".panel") as HTMLElement);
beforeEach(() => {
  vi.resetAllMocks();
  appStore.set({ activeModelId: "qwen-7b", running: null, installed: [], installedModels: [] });
  vi.mocked(modelManager.list).mockResolvedValue(base);
  vi.mocked(modelManager.check).mockResolvedValue(llama);
});
afterEach(cleanup);
async function setup() {
  const result = render(<ModelsPage />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled());
  return result;
}

describe("Ollama Models page", () => {
  it("shows actual tags and sizes, including external models, and selects one for chat", async () => {
    await setup();
    expect(screen.getByText("qwen2.5:7b")).toBeInTheDocument();
    expect(screen.getByText("Storage: 4.00 GB")).toBeInTheDocument();
    expect(screen.getByText("Storage: 0.12 GB")).toBeInTheDocument();
    expect(row("Qwen 7B").getByText("Selected for chat")).toBeInTheDocument();
    fireEvent.click(row("my/custom:latest").getByRole("button", { name: "Use in chat" }));
    expect(appStore.get().activeModelId).toBe(custom.id);
    expect(row("my/custom:latest").getByText("Selected for chat")).toBeInTheDocument();
  });

  it("requires confirmation, allows cancelling it, and chooses a fallback after confirmed removal", async () => {
    vi.mocked(modelManager.remove).mockResolvedValue({ ...base, installed: [custom] });
    await setup();
    fireEvent.click(row("Qwen 7B").getByRole("button", { name: "Remove" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("qwen2.5:7b");
    expect(modelManager.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(modelManager.remove).not.toHaveBeenCalled();
    fireEvent.click(row("Qwen 7B").getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));
    await waitFor(() => expect(appStore.get().activeModelId).toBe(custom.id));
    expect(modelManager.remove).toHaveBeenCalledWith("qwen2.5:7b", expect.any(AbortSignal));
    expect(screen.queryByText("Qwen 7B")).not.toBeInTheDocument();
  });

  it("clears selection when the last model is deleted", async () => {
    vi.mocked(modelManager.list).mockResolvedValue({ ...base, installed: [qwen] });
    vi.mocked(modelManager.remove).mockResolvedValue({ ...base, installed: [] });
    await setup();
    fireEvent.click(row("Qwen 7B").getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));
    await screen.findByText(/No models installed yet/);
    expect(appStore.get().activeModelId).toBe("");
    expect(appStore.get().running).toBeNull();
  });

  it("preserves the selected model when another model is removed", async () => {
    vi.mocked(modelManager.remove).mockResolvedValue({ ...base, installed: [qwen] });
    await setup();
    fireEvent.click(row("my/custom:latest").getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));
    await waitFor(() => expect(appStore.get().installed).toEqual([qwen.id]));
    expect(appStore.get().activeModelId).toBe(qwen.id);
  });

  it("keeps rows and selection after deletion fails", async () => {
    vi.mocked(modelManager.remove).mockRejectedValue(
      new Error("Ollama could not remove the model"),
    );
    await setup();
    fireEvent.click(row("Qwen 7B").getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not remove");
    expect(appStore.get().activeModelId).toBe(qwen.id);
    expect(screen.getByText("Qwen 7B")).toBeInTheDocument();
  });

  it("uses shared installation progress and refreshes verified inventory", async () => {
    let finish!: (status: ModelAvailability) => void;
    vi.mocked(modelManager.install).mockImplementation((_model, report) => {
      report({
        stage: "download",
        label: "Downloading model — current file",
        completed: 25,
        total: 100,
        percent: 25,
      });
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(appStore.get().installed).not.toContain("llama-8b");
    vi.mocked(modelManager.list).mockResolvedValue({
      installed: [
        ...base.installed,
        { id: "llama-8b", tag: llama.tag, name: "Llama 8B", sizeBytes: 456 },
      ],
      supported: [{ ...llama, installed: true }],
    });
    await act(async () => finish({ ...llama, installed: true }));
    await waitFor(() => expect(appStore.get().installed).toContain("llama-8b"));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(appStore.get().activeModelId).toBe(qwen.id);
  });

  it("cancels installation and ignores late progress and completion", async () => {
    let finish!: (status: ModelAvailability) => void;
    vi.mocked(modelManager.install).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await setup();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(modelManager.install).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(modelManager.install).mock.calls[0]![2];
    fireEvent.click(screen.getByRole("button", { name: "Cancel installation" }));
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ ...llama, installed: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("Installation cancelled");
    expect(appStore.get().installed).not.toContain(llama.modelId);
    await waitFor(() => expect(screen.getByRole("button", { name: "Install" })).toBeEnabled());
  });

  it("shows unavailable errors without falsely claiming an empty inventory", async () => {
    vi.mocked(modelManager.list).mockRejectedValueOnce(new Error("Open the Ollama app"));
    await setup();
    expect(screen.getByRole("alert")).toHaveTextContent("Open the Ollama app");
    expect(screen.queryByText(/No models installed yet/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Qwen 7B")).toBeInTheDocument();
  });

  it("marks stale inventory and disables operations if a refresh fails", async () => {
    await setup();
    vi.mocked(modelManager.list).mockRejectedValueOnce(new Error("Ollama stopped"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText(/Showing the last known model list/);
    expect(row("Qwen 7B").getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Install" })).toBeDisabled();
  });

  it("aborts an ongoing install when leaving the page", async () => {
    vi.mocked(modelManager.install).mockImplementation(() => new Promise(() => {}));
    const { unmount } = await setup();
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(modelManager.install).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(modelManager.install).mock.calls[0]![2];
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
