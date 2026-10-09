import { expect, it } from "vitest";
import { identifiedSources, webAnswerText, type WebSearch } from "./web-search";
const sources = [{ title: "Official", url: "https://example.org/docs", snippet: "Evidence" }];
const search: WebSearch = {
  status: "complete",
  notice: "Snippets",
  sources: identifiedSources(sources),
};
it("assigns IDs in application code and validates source numbers", () => {
  expect(search.sources[0]!.id).toBe("S1");
  expect(webAnswerText("Claim [1] [S1] [2] [S99]", search)).toBe(
    "Claim [S1] [S1] (unsupported reference) (unsupported reference)",
  );
});
it("does not expose invented links or incomplete streaming references", () => {
  expect(webAnswerText("Claim [fake](https://evil.example/path) [S", search)).not.toContain(
    "evil.example",
  );
  expect(webAnswerText("Claim [S", search)).toBe("Claim ");
  expect(webAnswerText("Claim [S1]", { ...search, sources: [] })).toBe(
    "Claim (unsupported reference)",
  );
});
it("keeps ordinary offline chat unchanged and supports legacy saved sources", () => {
  expect(webAnswerText("array[0] https://example.org", undefined)).toBe(
    "array[0] https://example.org",
  );
  expect(webAnswerText("Claim [1]", { ...search, sources })).toBe("Claim [S1]");
});

it("preserves assigned IDs if saved sources are reordered", () => {
  const assigned = identifiedSources([
    ...sources,
    { ...sources[0]!, url: "https://example.org/other" },
  ]);
  expect(identifiedSources(assigned.reverse()).map((s) => s.id)).toEqual(["S2", "S1"]);
});
