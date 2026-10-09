import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { CalendarPage } from "@/components/calendar-page";
import { calendar } from "@/lib/calendar";
import type { CalendarEvent } from "@/lib/calendar-config";
vi.mock("@/lib/calendar", () => ({ calendar: { list: vi.fn(), save: vi.fn(), remove: vi.fn() } }));
let records: CalendarEvent[] = [];
const clients: QueryClient[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  records = [];
  vi.mocked(calendar.list).mockImplementation(async () => [...records]);
  vi.mocked(calendar.save).mockImplementation(async (event, id) => {
    const saved = { ...event, id: id ?? crypto.randomUUID(), createdAt: "now", updatedAt: "now" };
    records = records.filter((e) => e.id !== saved.id);
    records.push(saved);
    return saved;
  });
  vi.mocked(calendar.remove).mockImplementation(async (id) => {
    records = records.filter((e) => e.id !== id);
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
      <CalendarPage />
    </QueryClientProvider>,
  );
}
it("prepares editable natural-language drafts but only saves after confirmation", async () => {
  view();
  await screen.findByText("No events here yet.");
  fireEvent.change(screen.getByLabelText("Event description"), {
    target: { value: "Add doctor appointment tomorrow at 3pm" },
  });
  fireEvent.click(screen.getByText("Prepare draft"));
  expect(screen.getByLabelText("Title")).toHaveValue("doctor appointment");
  expect(calendar.save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dentist" } });
  fireEvent.click(screen.getByText("Confirm and save"));
  await screen.findByRole("heading", { name: "Dentist" });
  expect(calendar.save).toHaveBeenCalledTimes(1);
});
it("loads persisted events, supports editing, and requires deletion confirmation", async () => {
  records = [
    {
      id: crypto.randomUUID(),
      title: "Existing",
      description: "",
      startsAt: "2099-10-09",
      endsAt: null,
      allDay: true,
      source: "manual",
      createdAt: "now",
      updatedAt: "now",
    },
  ];
  view();
  await screen.findByRole("heading", { name: "Existing" });
  fireEvent.click(screen.getByLabelText("Edit Existing"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
  fireEvent.click(screen.getByText("Confirm and save"));
  await screen.findByRole("heading", { name: "Renamed" });
  fireEvent.click(screen.getByLabelText("Delete Renamed"));
  expect(calendar.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete event" }));
  await waitFor(() => expect(records).toHaveLength(0));
});
it("creates a manual all-day event and cancels an ambiguous draft without saving", async () => {
  view();
  await screen.findByText("No events here yet.");
  fireEvent.click(screen.getByText("New event"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Day off" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2099-10-10" } });
  fireEvent.click(screen.getByLabelText("All day"));
  fireEvent.click(screen.getByText("Confirm and save"));
  await screen.findByRole("heading", { name: "Day off" });
  fireEvent.change(screen.getByLabelText("Event description"), {
    target: { value: "Meeting soon" },
  });
  fireEvent.click(screen.getByText("Prepare draft"));
  expect(screen.getByText(/date is missing or ambiguous/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(calendar.save).toHaveBeenCalledTimes(1);
});
it("retains draft when local storage fails", async () => {
  vi.mocked(calendar.save).mockRejectedValue(new Error("Disk full"));
  view();
  fireEvent.click(screen.getByText("New event"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Test" } });
  fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2099-10-10" } });
  fireEvent.click(screen.getByLabelText("All day"));
  fireEvent.click(screen.getByText("Confirm and save"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Disk full");
  expect(screen.getByLabelText("Title")).toHaveValue("Test");
});
