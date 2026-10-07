// @vitest-environment node
import { describe, it, expect } from "vitest";
import { extractText } from "./document-extraction.server";
import { chunkPages } from "./document-chunks";
import { pdfFixture } from "../test/fixtures/pdf";
const bytes = (text: string) => new TextEncoder().encode(text);
describe("local extraction and chunking", () => {
  it.each(["txt", "md"] as const)("extracts %s locally", async (type) => {
    expect(await extractText(bytes("# Notes\nCafé launch on Friday."), type)).toEqual([
      { page: null, text: "# Notes\nCafé launch on Friday." },
    ]);
  });
  it("extracts actual PDF text with page metadata", async () => {
    expect(await extractText(pdfFixture(), "pdf")).toEqual([
      { page: 1, text: "Local PDF fact: the launch code is ORCHID." },
    ]);
  });
  it("reports PDFs without text and corrupted PDFs clearly", async () => {
    await expect(extractText(pdfFixture(""), "pdf")).rejects.toThrow("OCR");
    await expect(extractText(bytes("%PDF-1.4\nbroken"), "pdf")).rejects.toThrow("corrupted");
    await expect(extractText(bytes("Not a PDF"), "pdf")).rejects.toThrow("valid PDF");
  });
  it("rejects invalid UTF8, binary, empty and excessive text", async () => {
    await expect(extractText(new Uint8Array([255]), "txt")).rejects.toThrow("UTF-8");
    await expect(extractText(bytes("binary\0text"), "txt")).rejects.toThrow("supported text");
    await expect(extractText(bytes("   "), "txt")).rejects.toThrow("no usable text");
    await expect(extractText(bytes("a".repeat(500001)), "md")).rejects.toThrow("limit");
  });
  it("chunks deterministically with overlap, limits and page boundaries", () => {
    const pages = [
      { text: "word ".repeat(700), page: 1 },
      { text: "End page", page: 2 },
    ];
    const chunks = chunkPages(pages);
    expect(chunkPages(pages)).toEqual(chunks);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((c) => c.text.length <= 1200)).toBe(true);
    expect(chunks[1]!.text.startsWith(chunks[0]!.text.slice(-180).trim())).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ page: 2, text: "End page" });
    expect(() => chunkPages([{ page: null, text: " " }])).toThrow("no usable text");
  });
});
