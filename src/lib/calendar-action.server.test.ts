// @vitest-environment node
import { it, expect, vi, afterEach } from "vitest";
import { prepareCalendarAction } from "./calendar-action.server";
vi.mock("./embeddings.server", () => ({
  requireLocalModel: vi.fn(async () => {}),
  localOllamaUrl: (path: string) => new URL(`http://127.0.0.1:11434/api/${path}`),
}));
const blank = {
  intent: "create",
  title: "Call Mom",
  dateExpression: "tomorrow",
  startTime: "8 PM",
  endDateExpression: "",
  endTime: "",
  allDay: false,
  description: "",
  location: "",
  uncertainties: [],
};
const now = new Date("2026-10-09T02:00:00Z");
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());
function model(result: unknown) {
  const fetcher = vi.fn(async () =>
    Response.json({ message: { content: JSON.stringify(result) } }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("extracts a direct reminder as a reviewable draft with runtime date and selected model", async () => {
  const fetcher = model(blank);
  const result = await prepareCalendarAction(
    "Add a reminder to call Mom tomorrow at 8 PM.",
    "qwen2.5:7b",
    "America/El_Salvador",
    signal(),
    now,
  );
  expect(result?.draft).toMatchObject({
    title: "Call Mom",
    date: "2026-10-09",
    time: "20:00",
    endDate: "",
    endTime: "",
  });
  const options = (fetcher.mock.calls[0] as unknown as [URL, RequestInit])[1];
  const request = JSON.parse(String(options.body));
  expect(request.model).toBe("qwen2.5:7b");
  expect(request.stream).toBe(false);
  expect(request.format.properties.intent.enum).toEqual(["create", "none"]);
  expect(request.messages[0].content).toContain("Current date: 2026-10-08");
  expect(result?.notices.join(" ")).toContain("no notification");
});
it.each([
  "How do calendars work?",
  "If I said add a reminder, what would you do?",
  "Explain the code: schedule a meeting",
  "Don't add a meeting tomorrow",
])("uses semantic intent to reject discussion or negation: %s", async (prompt) => {
  model({ ...blank, intent: "none" });
  expect(await prepareCalendarAction(prompt, "qwen2.5:7b", "UTC", signal(), now)).toBeNull();
});
it("ordinary prompts do not call the extraction model", async () => {
  const fetcher = model(blank);
  expect(
    await prepareCalendarAction("Explain a JavaScript closure", "qwen2.5:7b", "UTC", signal(), now),
  ).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not accept invented dates, times or all-day assumptions", async () => {
  model({ ...blank, dateExpression: "2026-10-09", startTime: "8 PM", allDay: true });
  const result = await prepareCalendarAction(
    "Remind me to call Mom soon at 8",
    "qwen2.5:7b",
    "UTC",
    signal(),
    now,
  );
  expect(result?.draft).toMatchObject({ date: "", time: "", allDay: false });
  expect(result?.notices.join(" ")).toContain("What time");
});
it("handles explicit end times and location", async () => {
  model({
    ...blank,
    title: "Meet Alex",
    dateExpression: "October 15",
    startTime: "10 AM",
    endTime: "11 AM",
    location: "Office",
  });
  const result = await prepareCalendarAction(
    "Schedule a meeting with Alex on October 15 from 10 AM to 11 AM at Office",
    "qwen2.5:7b",
    "UTC",
    signal(),
    now,
  );
  expect(result?.draft).toMatchObject({
    date: "2026-10-15",
    time: "10:00",
    endDate: "2026-10-15",
    endTime: "11:00",
    location: "Office",
  });
});
it("fails safely on malformed model output and honours cancellation", async () => {
  model({ intent: "saved" });
  await expect(
    prepareCalendarAction("Add a meeting tomorrow", "qwen2.5:7b", "UTC", signal(), now),
  ).rejects.toThrow("Nothing was added");
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: URL, options: RequestInit) => {
      options.signal?.throwIfAborted();
      return Response.json({});
    }),
  );
  await expect(
    prepareCalendarAction("Add a meeting tomorrow", "qwen2.5:7b", "UTC", controller.signal, now),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("uses the user's explicit time when the model reformats it", async () => {
  model({ ...blank, startTime: "20:00", dateExpression: "2026-10-09" });
  const result = await prepareCalendarAction(
    "Add a reminder to call Mom tomorrow at 8 PM.",
    "qwen2.5:7b",
    "America/El_Salvador",
    signal(),
    now,
  );
  expect(result?.draft).toMatchObject({ date: "2026-10-09", time: "20:00" });
});

it("resolves an explicit month date even if the model reformats it", async () => {
  model({ ...blank, dateExpression: "2026-10-15", startTime: "10:00" });
  const result = await prepareCalendarAction(
    "Schedule a meeting with Alex on October 15 at 10 AM.",
    "qwen2.5:7b",
    "UTC",
    signal(),
    now,
  );
  expect(result?.draft).toMatchObject({ date: "2026-10-15", time: "10:00" });
});
