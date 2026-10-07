import { z } from "zod";

// Shared bounds keep uploads, indexing, and model context predictable.
export const documentLimits = {
  bytes: 10 * 1024 * 1024,
  files: 20,
  characters: 500_000,
  pages: 500,
  chunks: 600,
  chunkSize: 1200,
  overlap: 180,
  retrieved: 4,
};
export const documentSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  filename: z.string(),
  type: z.enum(["pdf", "txt", "md"]),
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
