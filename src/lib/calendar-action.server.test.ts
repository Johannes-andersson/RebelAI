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

it("prepares a document-based draft only from copied evidence and never saves an event", async () => {
  model({
    ...blank,
    title: "Project meeting",
    dateExpression: "October 20, 2026",
    startTime: "3 PM",
  });
  const result = await prepareCalendarAction(
    "Find the meeting in my files and add it to my calendar",
    "qwen2.5:7b",
    "UTC",
    signal(),
    now,
    [
      {
        fileId: "f",
        filename: "meeting.txt",
        chunkIndex: 0,
        page: null,
        text: "Project meeting on October 20, 2026 at 3 PM.",
      },
    ],
  );
  expect(result?.draft).toMatchObject({
    date: "2026-10-20",
    time: "15:00",
    title: "Project meeting",
  });
  expect(result?.notices.join(" ")).toContain("untrusted document excerpts");
});
it("keeps fabricated document dates empty and asks to resolve conflicting dates", async () => {
  model({ ...blank, dateExpression: "October 20, 2026", startTime: "3 PM" });
  const prompt = "Find the deadline in my PDFs and prepare a calendar event";
  const empty = await prepareCalendarAction(prompt, "qwen2.5:7b", "UTC", signal(), now, []);
  expect(empty?.draft.date).toBe("");
  expect(empty?.draft.time).toBe("");
  const conflict = await prepareCalendarAction(prompt, "qwen2.5:7b", "UTC", signal(), now, [
    {
      fileId: "f",
      filename: "test.txt",
      chunkIndex: 0,
      page: null,
      text: "October 20, 2026 at 3 PM. October 25, 2026 at 4 PM.",
    },
  ]);
  expect(conflict?.draft.date).toBe("");
  expect(conflict?.draft.time).toBe("");
});

it("returns a real clarification card when an explicit prepare request is misclassified", async () => {
  model({ ...blank, intent: "none" });
  const result = await prepareCalendarAction(
    "Find the meeting date in the selected document and prepare a calendar event.",
    "qwen2.5:7b",
    "UTC",
    signal(),
    now,
    [],
  );
  expect(result?.draft.date).toBe("");
  expect(result?.notices.join(" ")).toContain("Nothing has been saved");
});

it("matches reformatted dates and times to literal document evidence", async () => {
  model({ ...blank, title: "Project meeting", dateExpression: "2026-10-20", startTime: "15:00" });
  const result = await prepareCalendarAction(
    "Find the meeting in my documents and prepare a calendar event",
    "qwen2.5:7b",
    "UTC",
    signal(),
    now,
    [
      {
        fileId: "f",
        filename: "meeting.txt",
        chunkIndex: 0,
        page: null,
        text: "Project meeting on October 20, 2026 at 3 PM.",
      },
    ],
  );
  expect(result?.draft).toMatchObject({ date: "2026-10-20", time: "15:00" });
});
