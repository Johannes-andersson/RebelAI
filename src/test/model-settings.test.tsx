import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ModelSettings } from "@/components/model-settings";
import { GenerationPerformance } from "@/components/generation-performance";
import { modelSettings } from "@/lib/generation";
import { modelManager } from "@/lib/model-manager";
import { appStore } from "@/lib/store";
import type { GenerationPreferences, GenerationProfile } from "@/lib/generation-config";
vi.mock("@/lib/generation", () => ({ modelSettings: vi.fn() }));
vi.mock("@/lib/model-manager", () => ({ modelManager: { list: vi.fn() } }));
const preferences = new Map<string, GenerationPreferences>();
const clients: QueryClient[] = [];
const profile = (tag: string): GenerationProfile => ({
  tag,
  preferences: preferences.get(tag) ?? { mode: "automatic" },
  sizeBytes: 2 ** 30,
  modelContext: 32768,
  limit: 8192,
  recommended: 4096,
  reason: "Conservative RAM estimate",
  totalBytes: 16 * 2 ** 30,
  freeBytes: 8 * 2 ** 30,
  warning: null,
  options: { num_ctx: 4096, num_predict: 1024 },
  loadedNotice: "Loaded-model status could not be verified.",
});
beforeEach(() => {
  vi.clearAllMocks();
  preferences.clear();
  appStore.set({ activeModelId: "a" });
  vi.mocked(modelManager.list).mockResolvedValue({
    installed: [
      { id: "a", tag: "a:latest", name: "A", sizeBytes: 2 ** 30 },
      { id: "b", tag: "b:latest", name: "B", sizeBytes: 2 ** 30 },
    ],
    supported: [],
  });
  vi.mocked(modelSettings).mockImplementation(async (tag, value) => {
    if (value) preferences.set(tag, value);
    return profile(tag);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
});
function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <ModelSettings />
    </QueryClientProvider>,
  );
}
it("starts automatic, saves actual custom values, switches independently, and resets", async () => {
  view();
  const mode = await screen.findByRole("combobox", { name: "Generation mode" });
  expect(mode).toHaveValue("automatic");
  expect(screen.getByRole("spinbutton", { name: "Temperature" })).toBeDisabled();
  fireEvent.change(mode, { target: { value: "custom" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Temperature" }), {
    target: { value: "0.25" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum output tokens" }), {
    target: { value: "200" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await waitFor(() =>
    expect(preferences.get("a:latest")).toMatchObject({ temperature: 0.25, maxOutput: 200 }),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Model to configure" }), {
    target: { value: "b:latest" },
  });
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Generation mode" })).toHaveValue("automatic"),
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Model to configure" }), {
    target: { value: "a:latest" },
  });
  await waitFor(() =>
    expect(screen.getByRole("spinbutton", { name: "Temperature" })).toHaveValue(0.25),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset to Default" }));
  await waitFor(() => expect(preferences.get("a:latest")).toEqual({ mode: "automatic" }));
  expect(appStore.get().activeModelId).toBe("a");
});
it("shows missing model errors and preserves failed-save drafts", async () => {
  view();
  fireEvent.change(await screen.findByRole("combobox", { name: "Generation mode" }), {
    target: { value: "custom" },
  });
  fireEvent.change(screen.getByRole("spinbutton", { name: "Temperature" }), {
    target: { value: "0.5" },
  });
  vi.mocked(modelSettings).mockRejectedValueOnce(new Error("Model is no longer installed"));
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("no longer installed");
  expect(screen.getByRole("spinbutton", { name: "Temperature" })).toHaveValue(0.5);
});
it("labels estimates and measurements separately, omitting unknown speed", async () => {
  view();
  await screen.findByRole("combobox", { name: "Generation mode" });
  fireEvent.click(screen.getByText("Advanced settings and performance details"));
  expect(screen.getByText(/Estimated weight memory:/)).toHaveTextContent("not measured VRAM");
  render(
    <GenerationPerformance
      message={{
        id: "reply",
        conversationId: "one",
        createdAt: "now",
        role: "assistant",
        content: "Partial",
        status: "interrupted",
        performance: { modelTag: "a:latest", elapsedMs: 1000, estimatedPromptTokens: 200 },
      }}
    />,
  );
  fireEvent.click(screen.getByText("Response performance"));
  expect(screen.getByText(/Status: Cancelled or interrupted/)).toBeInTheDocument();
  expect(screen.getByText(/Measured request duration:/)).toBeInTheDocument();
  expect(screen.getByText(/Estimated prompt tokens:/)).toBeInTheDocument();
  expect(screen.queryByText(/Measured generation speed/)).toBeNull();
});
