import { documentSchema, documentLimits, documentSearchStatusSchema } from "./document-config";
async function request(conversationId: string, id = "", options?: RequestInit) {
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/documents${id ? `/${encodeURIComponent(id)}` : ""}`,
    { cache: "no-store", ...options },
  ).catch((error: unknown) => {
    if (options?.signal?.aborted) throw error;
    throw new Error(
      "Cannot reach local attachment storage. Check that Rebel AI is running and retry.",
    );
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(
      typeof data?.error === "string" ? data.error : "The local attachment request failed.",
    );
  }
  return response.status === 204 ? null : response.json();
}
export const documents = {
  async searchStatus(signal?: AbortSignal) {
    const response = await fetch("/api/document-search", {
      cache: "no-store",
      signal: signal ?? null,
    });
    if (!response.ok) throw new Error("Could not check document-search preparation.");
    return documentSearchStatusSchema.parse(await response.json());
  },
  async prepareSearch() {
    const response = await fetch("/api/document-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok)
      throw new Error("The local document-search component could not be prepared. Please retry.");
    return documentSearchStatusSchema.parse(await response.json());
  },
  async list(conversationId: string, signal?: AbortSignal) {
    return documentSchema
      .array()
      .parse(await request(conversationId, "", { signal: signal ?? null }));
  },
  async upload(conversationId: string, file: File) {
    if (file.size > documentLimits.bytes) throw new Error("File too large. The limit is 10 MB.");
    if (!/\.(pdf|txt|md|markdown)$/i.test(file.name))
      throw new Error("Unsupported file type. Attach a PDF, TXT, or Markdown file.");
    return documentSchema.parse(
      await request(conversationId, "", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      }),
    );
  },
  async retry(conversationId: string, id: string) {
    return documentSchema.parse(
      await request(conversationId, id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
  },
  async remove(conversationId: string, id: string) {
    await request(conversationId, id, { method: "DELETE" });
  },
};
