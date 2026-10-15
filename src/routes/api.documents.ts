import { createFileRoute } from "@tanstack/react-router";
import { getConversations } from "@/lib/conversations.server";
import { checkLocalConversationRequest, conversationFailure } from "@/lib/conversation-api.server";
export const Route = createFileRoute("/api/documents")({
  server: {
    handlers: {
      GET: ({ request }) => {
        try {
          checkLocalConversationRequest(request);
          const db = getConversations().documents;
          const id = new URL(request.url).searchParams.get("id");
          if (id) {
            const file = db.find(id);
            const types: Record<string, string> = {
              pdf: "application/pdf",
              txt: "text/plain; charset=utf-8",
              md: "text/plain; charset=utf-8",
              jpg: "image/jpeg",
              png: "image/png",
              webp: "image/webp",
            };
            return new Response(db.storage.read(id), {
              headers: {
                "Content-Type": types[file.type]!,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "sandbox",
                "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
              },
            });
          }
          return Response.json(db.library(), {
            headers: { "Cache-Control": "no-store" },
          });
        } catch (error) {
          return conversationFailure(error);
        }
      },
    },
  },
});
