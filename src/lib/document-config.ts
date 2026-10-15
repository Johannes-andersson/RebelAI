import { z } from "zod";

// Shared bounds keep uploads, indexing, and model context predictable.
export const documentLimits = {
  bytes: 10 * 1024 * 1024,
  files: 100,
  totalBytes: 1024 * 1024 * 1024,
  characters: 500_000,
  pages: 500,
  chunks: 600,
  totalChunks: 6000,
  chunkSize: 1200,
  overlap: 180,
  retrieved: 4,
};
export const documentSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  filename: z.string(),
  relativePath: z.string().optional(),
  contentHash: z.string().nullable().optional(),
  type: z.enum(["pdf", "txt", "md", "jpg", "png", "webp"]),
  size: z.number(),
  createdAt: z.string(),
  status: z.enum(["importing", "extracting", "preparing", "indexing", "ready", "error"]),
  error: z.string().nullable(),
  embeddingModel: z.string().nullable(),
});
export type AttachedDocument = z.infer<typeof documentSchema>;
export const sourceSchema = z.object({
  fileId: z.string(),
  filename: z.string(),
  chunkIndex: z.number(),
  page: z.number().nullable(),
  text: z.string(),
});
export type DocumentSource = z.infer<typeof sourceSchema>;
export interface TextPage {
  text: string;
  page: number | null;
}
export interface DocumentChunk extends TextPage {
  index: number;
}
export interface IndexedChunk extends DocumentChunk {
  vector: number[];
}
export class DocumentError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export const documentSearchStatusSchema = z.object({
  status: z.enum(["idle", "preparing", "ready", "error"]),
  progress: z
    .object({ percent: z.number().nullable(), completed: z.number(), total: z.number() })
    .nullable(),
  error: z.string().nullable(),
});
export type DocumentSearchStatus = z.infer<typeof documentSearchStatusSchema>;

export function documentAnswerText(content: string, count?: number) {
  if (count === undefined) return content;
  return content
    .split(/(`{3,}[^\n]*\n[\s\S]*?(?:`{3,}|$)|~{3,}[^\n]*\n[\s\S]*?(?:~{3,}|$)|`[^`\n]*`)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/\[([^\]]*)\]\([^)]*(?:\)|$)/g, "$1 (link omitted; see sources)")
            .replace(/(?:https?:\/\/|www\.)[^\s)\]]*/gi, "(link omitted; see sources)")
            .replace(/\[D(\d+)\]/gi, (value, number) =>
              Number(number) > 0 && Number(number) <= count
                ? value
                : "[unavailable document source]",
            ),
    )
    .join("");
}
