import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReminderProvider } from "@/components/reminder-provider";
import { NotificationIndicator } from "@/components/notification-indicator";
import { reminderRequest } from "@/lib/reminders";
import type { ReminderDelivery } from "@/lib/reminder-config";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/reminders", () => ({ reminderRequest: vi.fn() }));
const delivery = (id = "1"): ReminderDelivery => ({
  id,
  reminderId: id,
  title: `Test ${id}`,
  dueAt: "2026-10-15T12:00:00Z",
  status: "delivered",
  desktop: "not-requested",
});
let pending: ReminderDelivery[];
function setup(permission = "denied") {
  pending = [delivery()];
  vi.useFakeTimers();
  const notification = Object.assign(
    vi.fn(function () {
      return { onshow: null, onerror: null };
    }),
    { permission, requestPermission: vi.fn() },
  );
  vi.stubGlobal("Notification", notification);
  vi.mocked(reminderRequest).mockImplementation(async (body?: unknown) => {
    const b = body as { kind?: string; id?: string; status?: string } | undefined;
    if (b?.kind === "claim") return [] as never;
    if (b?.kind === "desktop") {
      const r = pending.find((r) => r.id === b.id);
      const reserved = r?.desktop === "not-requested";
      if (r && reserved) r.desktop = "attempted";
      return { reserved } as never;
    }
    if (b?.kind === "status" && ["acknowledged", "dismissed"].includes(b.status!))
      pending = pending.filter((r) => r.id !== b.id);
    return {
      history: pending,
      pending: [...pending],
      settings: { enabled: true, lead: 15 },
      reminders: [],
    } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (page: string) => (
    <QueryClientProvider client={client}>
      <ReminderProvider>
        <div key={page}>
          {page}
          <NotificationIndicator />
        </div>
      </ReminderProvider>
    </QueryClientProvider>
  );
  return { notification, tree };
}
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it.each(["denied", "default", "unsupported"])(
  "shows title, due time and actions with %s desktop notifications",
  async (permission) => {
    const { tree, notification } = setup(permission);
    if (permission === "unsupported") Reflect.deleteProperty(window, "Notification");
    render(tree("Chat"));
    await flush();
    expect(screen.getByText("Test 1")).toBeVisible();
    expect(screen.getByText(/^Due /)).toBeVisible();
    expect(notification).not.toHaveBeenCalled();
    expect(notification.requestPermission).not.toHaveBeenCalled();
  },
);
it("keeps one controller and pending alerts across all route child replacements", async () => {
  const { tree } = setup();
  const view = render(tree("Reminders"));
  await flush();
  for (const page of ["Chat", "Calendar", "Tasks", "Files", "Settings"]) {
    view.rerender(tree(page));
    await flush();
    expect(screen.getByText("Test 1")).toBeVisible();
  }
  expect(
    vi
      .mocked(reminderRequest)
      .mock.calls.filter(([b]) => (b as { kind?: string })?.kind === "claim"),
  ).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(
    vi
      .mocked(reminderRequest)
      .mock.calls.filter(([b]) => (b as { kind?: string })?.kind === "claim"),
  ).toHaveLength(2);
});
it("does not overlap polls, and aborts the pending request on unmount", async () => {
  const { tree } = setup();
  let signal: AbortSignal | undefined;
  vi.mocked(reminderRequest).mockImplementation((_b, s) => {
    signal = s;
    return new Promise(() => {});
  });
  const view = render(tree("Chat"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45000);
  });
  expect(reminderRequest).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
it("recovers a lost claim response from durable pending history after network recovery", async () => {
  const { tree } = setup();
  vi.mocked(reminderRequest).mockRejectedValueOnce(new Error("offline"));
  render(tree("Calendar"));
  await flush();
  expect(screen.getByText(/retrying/)).toBeVisible();
  await act(async () => {
    window.dispatchEvent(new Event("online"));
  });
  await flush();
  expect(screen.getByText("Test 1")).toBeVisible();
});
it("acknowledges without repeating and leaves other due reminders accessible", async () => {
  const { tree } = setup();
  pending.push(delivery("2"));
  render(tree("Tasks"));
  await flush();
  fireEvent.click(screen.getAllByRole("button", { name: "Acknowledge" })[0]!);
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.queryByText("Test 1")).toBeNull();
  expect(screen.getByText("Test 2")).toBeVisible();
});
it("reserves desktop attempts once, and checks again when the document becomes visible", async () => {
  const { tree, notification } = setup("granted");
  render(tree("Files"));
  await flush();
  expect(notification).toHaveBeenCalledTimes(1);
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(notification).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Test 1")).toBeVisible();
});
it("wakes on visible without adding a hidden-tab polling loop", async () => {
  const { tree } = setup();
  render(tree("Settings"));
  await flush();
  const visible = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const before = vi.mocked(reminderRequest).mock.calls.length;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(reminderRequest).toHaveBeenCalledTimes(before);
  visible.mockReturnValue("visible");
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flush();
  expect(vi.mocked(reminderRequest).mock.calls.length).toBeGreaterThan(before);
  visible.mockRestore();
});
