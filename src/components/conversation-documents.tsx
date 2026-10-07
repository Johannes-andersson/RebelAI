import type { useDocuments } from "@/hooks/use-documents";
import type { DocumentSource } from "@/lib/document-config";
export function ConversationDocuments({
  documents,
  disabled = false,
}: {
  documents: ReturnType<typeof useDocuments>;
  disabled?: boolean;
}) {
  return (
    <div
      className="mb-3 max-h-48 space-y-2 overflow-y-auto text-xs"
      aria-label="Conversation attachments"
    >
      {documents.preparation?.status === "preparing" && (
        <div role="status" className="rounded-lg border border-border bg-panel px-3 py-2">
          <p>Preparing document search…</p>
          <p className="mt-1 text-muted-foreground">
            Rebel AI is installing a small local component needed to search your files.
          </p>
          {documents.preparation.progress?.percent != null && (
            <div className="mt-2 flex items-center gap-2">
              <progress
                className="h-1.5 flex-1 accent-primary"
                aria-label="Document search download"
                max={100}
                value={documents.preparation.progress.percent}
              />
              <span>{documents.preparation.progress.percent}% of current download</span>
            </div>
          )}
        </div>
      )}
      {documents.preparation?.status === "error" &&
        (!documents.files.length || documents.files.some((f) => f.status === "ready")) && (
          <p role="alert" className="text-destructive">
            {documents.preparation.error}{" "}
            <button
              type="button"
              className="link-quiet"
              disabled={documents.busy || disabled}
              onClick={() => void documents.prepareSearch()}
            >
              Retry document search
            </button>
          </p>
        )}
      {documents.importing && <p role="status">{documents.importing} · Importing…</p>}
      {documents.files.map((file) => (
        <div key={file.id} className="rounded-lg border border-border bg-panel px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={file.filename}>
              {file.filename}
            </span>
            <span
              className={file.status === "error" ? "text-destructive" : "text-muted-foreground"}
            >
              {file.status === "preparing"
                ? "Preparing document search…"
                : file.status[0]!.toUpperCase() + file.status.slice(1)}
            </span>
            {file.status === "error" && (
              <button
                type="button"
                className="link-quiet"
                disabled={documents.busy || disabled}
                onClick={() => void documents.retry(file.id)}
              >
                Retry
              </button>
            )}
            <button
              type="button"
              className="link-quiet"
              aria-label={`Remove ${file.filename}`}
              disabled={documents.busy || disabled}
              onClick={() => void documents.remove(file.id)}
            >
              Remove
            </button>
          </div>
          {file.error && (
            <p role="alert" className="mt-1 text-destructive">
              {file.error}
            </p>
          )}
        </div>
      ))}
      {documents.error && (
        <p role="alert" className="text-destructive">
          {documents.error}{" "}
          <button type="button" className="link-quiet" onClick={documents.reload}>
            Retry attachment list
          </button>
        </p>
      )}
    </div>
  );
}
export function MessageSources({ sources }: { sources?: DocumentSource[] | undefined }) {
  if (!sources?.length) return null;
  return (
    <details className="mt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">
        Based on: {[...new Set(sources.map((s) => s.filename))].join(", ")}
      </summary>
      <div className="mt-2 space-y-2">
        {sources.map((s) => (
          <blockquote key={`${s.fileId}:${s.chunkIndex}`} className="border-l-2 border-border pl-3">
            <p className="font-medium">
              {s.filename}
              {s.page !== null ? ` · Page ${s.page}` : ""} · Excerpt {s.chunkIndex + 1}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{s.text}</p>
          </blockquote>
        ))}
      </div>
    </details>
  );
}
