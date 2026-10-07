import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DocumentError, documentLimits } from "./document-config";

export class DocumentStorage {
  constructor(private directory: string) {}
  private path(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new DocumentError("Invalid attachment ID.");
    return join(this.directory, "attachments", id);
  }
  write(id: string, data: Uint8Array) {
    mkdirSync(join(this.directory, "attachments"), { recursive: true, mode: 0o700 });
    writeFileSync(this.path(id), data, { flag: "wx", mode: 0o600 });
  }
  read(id: string) {
    try {
      return new Uint8Array(readFileSync(this.path(id)));
    } catch {
      throw new DocumentError(
        "The local file is missing or unreadable. Remove it and attach the original again.",
      );
    }
  }
  exists(id: string) {
    return existsSync(this.path(id));
  }
  remove(id: string) {
    rmSync(this.path(id), { force: true });
  }
}
export async function readUpload(request: Request) {
  if (Number(request.headers.get("content-length")) > documentLimits.bytes)
    throw new DocumentError("File too large. The limit is 10 MB.", 413);
  if (!request.body) throw new DocumentError("Choose a non-empty file.");
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > documentLimits.bytes)
        throw new DocumentError("File too large. The limit is 10 MB.", 413);
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!size) throw new DocumentError("The file is empty.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
