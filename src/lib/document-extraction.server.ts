import {
  DocumentError,
  documentLimits,
  type AttachedDocument,
  type TextPage,
} from "./document-config";
export async function extractText(
  data: Uint8Array,
  type: AttachedDocument["type"],
): Promise<TextPage[]> {
  if (type !== "pdf") {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw new DocumentError(
        "Text files must use UTF-8 encoding. Save the file as UTF-8 and retry.",
      );
    }
    if (text.includes("\0")) throw new DocumentError("This is not a supported text file.");
    checkLength(text.length);
    if (!text.trim()) throw new DocumentError("The file contains no usable text.");
    return [{ text, page: null }];
  }
  if (!new TextDecoder().decode(data.slice(0, 1024)).includes("%PDF-"))
    throw new DocumentError("This PDF is corrupted or is not a valid PDF.");
  // Local bytes only. PDF.js never receives a URL and no rendering/OCR is invoked.
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Explicitly include the worker in Nitro's server bundle; PDF.js otherwise
  // looks for a relative worker file that bundlers do not automatically copy.
  // @ts-expect-error PDF.js does not publish types for its worker entry point.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const task = getDocument({
    data: data.slice(),
    useSystemFonts: true,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > documentLimits.pages)
      throw new DocumentError("This PDF exceeds the 500-page limit. Split it into smaller files.");
    const pages: TextPage[] = [];
    let length = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const sheet = await pdf.getPage(page);
      const content = await sheet.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .trim();
      length += text.length;
      checkLength(length);
      pages.push({ text, page });
      sheet.cleanup();
    }
    if (!pages.some((p) => /[\p{L}\p{N}]/u.test(p.text)))
      throw new DocumentError(
        "This PDF has no extractable text. Scanned/image-only PDFs require OCR, which is not supported yet.",
      );
    return pages;
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(
      "Could not extract this PDF. It may be corrupted or password-protected. Attach an unlocked text PDF.",
    );
  } finally {
    await task.destroy();
  }
}
function checkLength(length: number) {
  if (length > documentLimits.characters)
    throw new DocumentError(
      "This document exceeds the 500,000-character text limit. Split it into smaller files.",
    );
}
