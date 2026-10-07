import {
  documentLimits,
  DocumentError,
  type TextPage,
  type DocumentChunk,
} from "./document-config";
export function chunkPages(pages: TextPage[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  for (const page of pages) {
    const text = page.text
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim();
    let start = 0;
    while (start < text.length) {
      let end = Math.min(start + documentLimits.chunkSize, text.length);
      if (end < text.length) {
        const boundary = text.lastIndexOf(" ", end);
        if (boundary > start + documentLimits.chunkSize / 2) end = boundary;
      }
      const part = text.slice(start, end).trim();
      if (part) chunks.push({ index: chunks.length, page: page.page, text: part });
      if (chunks.length > documentLimits.chunks)
        throw new DocumentError("This document has too much text. Split it into smaller files.");
      if (end === text.length) break;
      start = Math.max(start + 1, end - documentLimits.overlap);
    }
  }
  if (!chunks.length) throw new DocumentError("The file contains no usable text.");
  return chunks;
}
