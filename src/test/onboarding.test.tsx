import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { Route } from "@/routes/index";
import { recommendHardware } from "@/lib/hardware-recommendation";
import type { SystemInfo } from "@/lib/types";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
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
