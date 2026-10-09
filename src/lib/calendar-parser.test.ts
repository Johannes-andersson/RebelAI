import { describe, it, expect } from "vitest";
import { describeEvent } from "./calendar-parser";
import { draftInput, emptyDraft, eventDraft } from "./calendar-config";
const now = new Date(2026, 9, 8, 12);
describe("local event drafts", () => {
  it("prepares tomorrow and an explicit PM time without a fabricated duration", () => {
    const result = describeEvent("Add doctor appointment tomorrow at 3pm", now);
    expect(result.draft).toMatchObject({
      title: "doctor appointment",
      date: "2026-10-09",
      time: "15:00",
      endDate: "",
      endTime: "",
    });
    expect(result.notices.join(" ")).toContain("Review");
  });
  it("requires AM/PM for ambiguous ranges", () => {
    const result = describeEvent("Create meeting with John on Monday from 10 to 11", now);
    expect(result.draft).toMatchObject({
      title: "meeting with John",
      date: "2026-10-12",
      time: "",
      endTime: "",
    });
    expect(result.notices.join(" ")).toContain("AM/PM");
  });
  it("parses explicit ranges and weekdays", () => {
    expect(describeEvent("Dinner Saturday from 7pm to 9pm", now).draft).toMatchObject({
      date: "2026-10-10",
      time: "19:00",
      endDate: "2026-10-10",
      endTime: "21:00",
    });
  });
  it("does not invent a time or recurrence for rent", () => {
    const result = describeEvent("Remind me to pay rent on the 1st", now);
    expect(result.draft).toMatchObject({ date: "2026-11-01", time: "", allDay: false });
    expect(result.notices.join(" ")).toContain("one-time");
  });
  it.each([
    "Lunch soon",
    "Meeting tomorrow at 3pm UTC",
    "Meeting tomorrow at 3pm or 4pm",
    "Meeting 2026-02-30 at 3pm",
    "Meeting Monday or Tuesday at 3pm",
    "Meeting next Monday at 3pm",
    "Meeting every Monday at 3pm",
  ])("leaves uncertain dates empty: %s", (text) => {
    expect(describeEvent(text, now).draft.date).toBe("");
  });
  it("requires missing fields and rejects reversed ranges or invalid dates", () => {
    expect(() => draftInput(emptyDraft())).toThrow();
    expect(() =>
      draftInput({ ...emptyDraft(), title: "Event", date: "2026-02-30", allDay: true }),
    ).toThrow();
    expect(() =>
      draftInput({
        ...emptyDraft(),
        title: "Event",
        date: "2026-10-08",
        time: "15:00",
        endDate: "2026-10-08",
        endTime: "14:00",
      }),
    ).toThrow();
  });
  it("round trips local times and all-day date-only values", () => {
    for (const allDay of [true, false]) {
      const draft = {
        ...emptyDraft(),
        title: "Test",
        date: "2026-10-09",
        time: allDay ? "" : "15:00",
        allDay,
      };
      const input = draftInput(draft);
      const event = { ...input, id: crypto.randomUUID(), createdAt: "now", updatedAt: "now" };
      expect(eventDraft(event)).toEqual(draft);
      if (allDay) expect(input.startsAt).toBe("2026-10-09");
    }
  });
});
