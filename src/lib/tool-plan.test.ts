import { it, expect } from "vitest";
import { planTools, toolLimits } from "./tool-plan";
it("keeps ordinary chat local and bounds the fixed plan", () => {
  const plan = planTools("Explain JavaScript closures", false, 0);
  expect(plan).toMatchObject({
    documents: false,
    images: false,
    calendar: false,
    web: { needed: false },
  });
  expect(toolLimits).toMatchObject({ webRequests: 1, calendarDrafts: 1, files: 20, images: 4 });
});
it("coordinates files and calendar without sending dates to web search", () => {
  expect(
    planTools("Find the deadline in my PDFs and add it to my calendar tomorrow", true, 0),
  ).toMatchObject({ documents: true, fileCalendar: true, calendar: true, web: { needed: false } });
});
it("allows a public comparison but never derives web queries from private history", () => {
  const plan = planTools("Compare my files with the latest public information online", true, 1, [
    {
      role: "user",
      content: "PRIVATE SECRET",
      id: "x",
      conversationId: "x",
      createdAt: "",
      status: "complete",
    },
  ]);
  expect(plan.images).toBe(true);
  expect(plan.documents).toBe(true);
  expect(plan.web.needed).toBe(true);
  expect(plan.web.query).not.toContain("SECRET");
});
it("does not authorize actions from discussion of a calendar", () => {
  expect(planTools("Summarize my documents about a calendar meeting", true, 0).calendar).toBe(
    false,
  );
  expect(planTools("Do not add a meeting; summarize the files", true, 0).calendar).toBe(false);
});
