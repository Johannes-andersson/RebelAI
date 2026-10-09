import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { documents } from "@/lib/documents";
import { useConversations } from "@/hooks/use-conversations";
import { useDocuments } from "@/hooks/use-documents";
import { ConversationDocuments } from "./conversation-documents";

function UploadPanel({ id }: { id: string }) {
  const docs = useDocuments(id);
  const client = useQueryClient();
  return (
    <section
      className="rounded-xl border border-border bg-panel p-5 space-y-3"
      aria-label="Manage conversation files"
    >
      <label className="block text-sm">
        Attach a file to this conversation
        <input
          aria-label="Upload document"
          className="mt-2 block w-full text-sm"
          type="file"
          accept=".pdf,.txt,.md,.markdown"
          disabled={docs.busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              docs.upload(file);
            }
            e.target.value = "";
            void client.invalidateQueries({ queryKey: ["document-library"] });
          }}
        />
      </label>
      <ConversationDocuments documents={docs} />
      <Link className="link-quiet" to="/chat" search={{ conversation: id }}>
        Open conversation to ask about these files
      </Link>
    </section>
  );
}
export function FileLibrary() {
  const client = useQueryClient();
  const history = useConversations();
  const library = useQuery({
    queryKey: ["document-library"],
    queryFn: ({ signal }) => documents.library(signal),
    retry: false,
    refetchInterval: 2000,
  });
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const exists = history.recent.data?.some((c) => c.id === selected);
  return (
    <div className="flex-1 overflow-y-auto p-10 space-y-6">
      <p className="text-sm text-muted-foreground">
        PDF, TXT, and Markdown · Up to 10 MB per file and 20 files per conversation. Files and
        document search stay on this computer. Scanned PDFs need selectable text; OCR and folder
        import are not supported.
      </p>
      <p className="text-sm text-muted-foreground">
        Choose a conversation for uploads. Files are searched only inside that conversation.
        Removing a file also removes its saved excerpts; deleting its conversation removes its
        files.
      </p>
      <div className="flex items-end gap-3">
        <label className="flex-1 text-sm">
          Conversation
          <select
            className="mt-1 w-full rounded border border-border bg-panel p-2"
            value={exists ? selected : ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Choose a conversation</option>
            {history.recent.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn-secondary"
          disabled={history.create.isPending}
          onClick={async () => {
            setError(null);
            try {
              const conversation = await history.create.mutateAsync();
              setSelected(conversation.id);
            } catch {
              setError("Could not create a conversation. Please retry.");
            }
          }}
        >
          New file conversation
        </button>
      </div>
      {(error || history.recent.error || library.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? history.recent.error?.message ?? library.error?.message}
          <button
            className="link-quiet ml-2"
            onClick={() => {
              setError(null);
              void library.refetch();
              void history.recent.refetch();
            }}
          >
            Retry
          </button>
        </p>
      )}
      {exists && <UploadPanel key={selected} id={selected} />}
      <section className="space-y-3" aria-label="All local files">
        <h2 className="font-medium">All local files</h2>
        {library.isPending && <p role="status">Loading files…</p>}
        {library.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No files uploaded yet. Choose or create a conversation above to add your first document.
          </p>
        )}
        {library.data?.map((file) => (
          <article key={file.id} className="rounded-xl border border-border bg-panel p-4">
            <h3 className="font-medium break-all">{file.filename}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {file.type.toUpperCase()} · {(file.size / 1024).toFixed(1)} KB ·{" "}
              {new Date(file.createdAt).toLocaleDateString()} ·{" "}
              {file.status === "preparing" ? "Preparing document search…" : file.status}
            </p>
            <p className="text-sm text-muted-foreground">
              Conversation:{" "}
              {history.recent.data?.find((c) => c.id === file.conversationId)?.title ?? "Loading…"}
            </p>
            {file.error && <p className="text-sm text-destructive">{file.error}</p>}
            <div className="mt-3 flex gap-3">
              <Link
                className="link-quiet"
                to="/chat"
                search={{ conversation: file.conversationId }}
              >
                Chat with files
              </Link>
              <button
                className="link-quiet"
                onClick={() => {
                  setSelected(file.conversationId);
                  void client.invalidateQueries({ queryKey: ["documents", file.conversationId] });
                }}
              >
                Manage / remove
              </button>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
