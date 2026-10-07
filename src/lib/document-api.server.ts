import { z } from "zod";
import { getConversations, type ConversationRepository } from "./conversations.server";
import { DocumentError } from "./document-config";
import { readUpload } from "./document-storage.server";
import { startDocumentJob, cancelDocumentJob } from "./document-processing.server";
export async function handleDocuments(
  request: Request,
  conversationId: string,
  id?: string,
  repository?: ConversationRepository,
) {
  try {
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new DocumentError("Cross-origin attachment requests are not allowed.", 403);
    if (
      !z.string().uuid().safeParse(conversationId).success ||
      (id && !z.string().uuid().safeParse(id).success)
    )
      throw new DocumentError("Invalid attachment or conversation ID.");
    const repo = repository ?? getConversations();
    repo.get(conversationId);
    const db = repo.documents;
    let result;
    if (request.method === "GET" && !id) {
      for (const file of db.list(conversationId))
        if (file.status === "ready" && !db.storage.exists(file.id))
          db.state(
            file.id,
            "error",
            "The local file is missing. Remove it and attach the original again.",
          );
      result = db.list(conversationId);
    } else if (request.method === "POST" && !id) {
      if (request.headers.get("content-type") !== "application/octet-stream")
        throw new DocumentError("Expected a local file upload.", 415);
      let name: string;
      try {
        name = decodeURIComponent(request.headers.get("x-file-name") ?? "");
      } catch {
        throw new DocumentError("Invalid filename.");
      }
      const file = db.create(conversationId, name, await readUpload(request));
      try {
        startDocumentJob(db, conversationId, file.id);
      } catch (error) {
        db.state(
          file.id,
          "error",
          error instanceof Error ? error.message : "Retry processing this file.",
        );
      }
      result = db.get(conversationId, file.id);
    } else if (request.method === "POST" && id) {
      if (request.headers.get("content-type") !== "application/json")
        throw new DocumentError("Expected a JSON retry request.", 415);
      db.get(conversationId, id);
      startDocumentJob(db, conversationId, id);
      result = db.get(conversationId, id);
    } else if (request.method === "DELETE" && id) {
      cancelDocumentJob(id);
      db.delete(conversationId, id);
      return new Response(null, { status: 204 });
    } else throw new DocumentError("Method not allowed.", 405);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof Error && "status" in error && typeof error.status === "number";
    return Response.json(
      {
        error: known
          ? error.message
          : "Could not access local attachments. Check disk space and permissions.",
      },
      { status: known ? (error.status as number) : 500 },
    );
  }
}
