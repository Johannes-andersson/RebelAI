/* eslint-disable no-control-regex -- reject unsafe filename and path characters */
import { z } from "zod";
import { DocumentError } from "./document-config";
export const fileAccept = ".pdf,.txt,.md,.markdown,.jpg,.jpeg,.png,.webp";
export const isImage = (type: string) => ["jpg", "png", "webp"].includes(type);
export function relativePath(value: string) {
  if (!value) return "";
  const parts = value.split("/");
  if (
    value.length > 500 ||
    value.includes("\\") ||
    parts.some((p) => !p || p === "." || p === ".." || /[:\x00-\x1f\x7f]/.test(p))
  )
    throw new DocumentError("Choose a safe relative folder path without parent directories.");
  return parts.join("/");
}
export const pendingAttachmentSchema = z
  .object({
    filename: z.string().min(1).max(255),
    data: z
      .string()
      .max(14_000_000)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  })
  .strict();
export type PendingAttachment = z.infer<typeof pendingAttachmentSchema>;
export function fileUrl(id: string, page?: number | null) {
  return `/api/documents?id=${encodeURIComponent(id)}${page ? `#page=${page}` : ""}`;
}
export async function encodeFile(file: File): Promise<PendingAttachment> {
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Choose a non-empty file up to 10 MB.");
  if (!/\.(pdf|txt|md|markdown|jpg|jpeg|png|webp)$/i.test(file.name))
    throw new Error("Unsupported file type.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read this local file."));
    reader.onload = () =>
      resolve({ filename: file.name, data: String(reader.result).split(",")[1]! });
    reader.readAsDataURL(file);
  });
}
