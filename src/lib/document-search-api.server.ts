import { checkLocalConversationRequest } from "./conversation-api.server";
import { documentSearchStatus, prepareDocumentSearch } from "./embeddings.server";
export function handleDocumentSearch(request: Request): Response {
  try {
    checkLocalConversationRequest(request);
    if (request.method === "POST") {
      // Continue in the local server so navigation does not interrupt preparation.
      void prepareDocumentSearch().catch(() => {}); // Failure is exposed by GET.
    } else if (request.method !== "GET") return new Response(null, { status: 405 });
    return Response.json(documentSearchStatus(), {
      status: request.method === "POST" ? 202 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: "Could not prepare local document search. Please retry." },
      { status: error instanceof Error && "status" in error ? Number(error.status) : 500 },
    );
  }
}
