import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { ChatCalendarAction } from "@/components/chat-calendar-action";
import { calendar } from "@/lib/calendar";
import type { CalendarAction } from "@/lib/calendar-action";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/lib/calendar", () => ({ calendar: { decide: vi.fn() } }));
const action: CalendarAction = {
  id: "request:assistant",
  userMessageId: "request",
  timeZone: "America/El_Salvador",
  createdAt: "2026-10-09T00:00:00Z",
  status: "pending",
  eventId: null,
  notices: ["No notification will be sent."],
  draft: {
    title: "Call Mom",
    description: "",
    location: "Home",
    date: "2026-10-09",
    time: "20:00",
    endDate: "",
    endTime: "",
    allDay: false,
  },
};
const clients: QueryClient[] = [];
beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
});
function view(value = action) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ChatCalendarAction action={value} conversationId="conversation" />
    </QueryClientProvider>,
  );
  return client;
}
it("shows a preview, edits it, and confirms only from a successful server response", async () => {
  let resolve!: (value: CalendarAction) => void;
  vi.mocked(calendar.decide).mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const client = view();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(screen.getByText("Call Mom")).toBeInTheDocument();
  expect(screen.getByText(/America\/El_Salvador/)).toBeInTheDocument();
  expect(calendar.decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Edit event"));
  fireEvent.change(screen.getByLabelText("Event title"), { target: { value: "Call family" } });
  fireEvent.click(screen.getByText("Confirm event"));
  fireEvent.click(screen.getByText("Saving…"));
  expect(calendar.decide).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Saved to your local calendar/)).toBeNull();
  resolve({
    ...action,
    status: "saved",
    eventId: "saved",
    draft: { ...action.draft, title: "Call family" },
  });
  await screen.findByText("Saved to your local calendar. No automatic alert will be sent.");
  expect(screen.getByText("Open Calendar")).toHaveAttribute("href", "/calendar");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["calendar"] });
});
it("cancels without confirming and remembers cancelled state on reload", async () => {
  vi.mocked(calendar.decide).mockResolvedValue({ ...action, status: "cancelled" });
  view();
  fireEvent.click(screen.getByText("Cancel event"));
  await screen.findByText("Cancelled. No event was created.");
  expect(calendar.decide).toHaveBeenCalledWith(action.id, "cancel", undefined);
  cleanup();
  view({ ...action, status: "cancelled" });
  expect(screen.queryByText("Confirm event")).toBeNull();
});
it("preserves edits after a failed save and offers a safe retry", async () => {
  vi.mocked(calendar.decide)
    .mockRejectedValueOnce(new Error("Disk full"))
    .mockResolvedValueOnce({ ...action, status: "saved", eventId: "saved" });
  view();
  fireEvent.click(screen.getByText("Confirm event"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
  expect(screen.queryByText(/Saved to your local calendar/)).toBeNull();
  fireEvent.click(screen.getByText("Confirm event"));
  await waitFor(() => expect(calendar.decide).toHaveBeenCalledTimes(2));
  await screen.findByText("Saved to your local calendar. No automatic alert will be sent.");
});
it("opens editable clarification fields for incomplete drafts and disables confirmation", () => {
  view({ ...action, draft: { ...action.draft, time: "" } });
  expect(screen.getByLabelText("Start time")).toHaveValue("");
  expect(screen.getByText("Confirm event")).toBeDisabled();
  expect(calendar.decide).not.toHaveBeenCalled();
});
