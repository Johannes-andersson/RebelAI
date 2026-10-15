import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { documents } from "@/lib/documents";
import type { AttachedDocument } from "@/lib/document-config";
import { isImage, fileUrl } from "@/lib/attachment-config";
export function FileMetadataEditor({ file }: { file: AttachedDocument }) {
  const client = useQueryClient();
  const [edit, setEdit] = useState(false),
    [name, setName] = useState(file.filename),
    [path, setPath] = useState(file.relativePath ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      setEdit(false);
      await client.invalidateQueries({ queryKey: ["document-library"] });
      await client.invalidateQueries({ queryKey: ["conversation"] });
      await client.invalidateQueries({ queryKey: ["documents"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update file.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="text-sm mt-2 space-y-2">
      <a className="link-quiet mr-3" href={fileUrl(file.id)} target="_blank" rel="noreferrer">
        Open source
      </a>
      <button className="link-quiet mr-3" disabled={busy} onClick={() => setEdit(!edit)}>
        Rename / move
      </button>
      {!isImage(file.type) && (
        <button
          className="link-quiet"
          disabled={busy || !["ready", "error"].includes(file.status)}
          onClick={() => void run(() => documents.retry(file.conversationId, file.id))}
        >
          Reindex
        </button>
      )}
      {edit && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => documents.rename(file.conversationId, file.id, name, path));
          }}
        >
          <label className="block">
            Filename
            <input
              aria-label="Filename"
              className="bg-panel border border-border ml-2 p-1"
              value={name}
              maxLength={255}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block">
            Relative path
            <input
              aria-label="Relative path"
              className="bg-panel border border-border ml-2 p-1"
              value={path}
              maxLength={500}
              placeholder="Folder/filename.txt"
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
          <button className="btn-primary" disabled={busy}>
            Save file details
          </button>
          <button type="button" className="link-quiet ml-2" onClick={() => setEdit(false)}>
            Cancel
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
