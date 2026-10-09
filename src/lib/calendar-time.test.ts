import { it, expect } from "vitest";
import { zonedParts, zonedInstant, validTimeZone } from "./calendar-time";
import { resolveEventDate } from "./calendar-action.server";
it("uses the user's calendar date across the UTC day boundary", () => {
  const now = new Date("2026-10-09T02:00:00Z");
  expect(zonedParts(now, "America/Los_Angeles").date).toBe("2026-10-08");
  expect(zonedParts(now, "Asia/Tokyo").date).toBe("2026-10-09");
  expect(resolveEventDate("tomorrow", "2026-10-08")).toBe("2026-10-09");
  expect(resolveEventDate("Friday", "2026-10-08")).toBe("2026-10-09");
  expect(resolveEventDate("next Tuesday", "2026-10-08")).toBe("2026-10-13");
  expect(resolveEventDate("October 15", "2026-10-08")).toBe("2026-10-15");
  expect(resolveEventDate("October 1", "2026-10-08")).toBe("2027-10-01");
  expect(resolveEventDate("next week", "2026-10-08")).toBe("");
});
it("converts actual zoned wall times including fractional offsets", () => {
  expect(zonedInstant("2026-10-09", "20:00", "America/El_Salvador")).toBe(
    "2026-10-10T02:00:00.000Z",
  );
  expect(zonedInstant("2026-10-09", "20:00", "Asia/Kathmandu")).toBe("2026-10-09T14:15:00.000Z");
  expect(validTimeZone("Imaginary/Zone")).toBe(false);
});
it("rejects DST gaps and repeated times rather than choosing an offset", () => {
  expect(() => zonedInstant("2026-03-08", "02:30", "America/New_York")).toThrow("does not exist");
  expect(() => zonedInstant("2026-11-01", "01:30", "America/New_York")).toThrow("occurs twice");
  expect(() => zonedInstant("2026-02-30", "20:00", "UTC")).toThrow();
});
