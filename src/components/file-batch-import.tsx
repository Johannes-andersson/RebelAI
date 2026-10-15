import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { documents } from "@/lib/documents";
import { fileAccept } from "@/lib/attachment-config";
export function FileBatchImport({ conversationId }: { conversationId: string }) {
  const client = useQueryClient(),
    running = useRef<AbortController | null>(null),
    folder = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<{ name: string; status: string }[]>([]),
    [busy, setBusy] = useState(false);
  useEffect(() => () => running.current?.abort(), []);
  async function run(files: File[]) {
    if (running.current) return;
    if (files.length > 100) {
      setRows([{ name: "Folder", status: "Choose at most 100 files per import." }]);
      return;
    }
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setRows(files.map((f) => ({ name: f.webkitRelativePath || f.name, status: "Waiting" })));
    const update = (i: number, status: string) =>
      setRows((items) => items.map((v, j) => (j === i ? { ...v, status } : v)));
    let active: string | undefined;
    try {
      for (let i = 0; i < files.length; i++) {
        if (controller.signal.aborted) {
          update(i, "Cancelled");
          continue;
        }
        try {
          update(i, "Uploading…");
          const file = await documents.upload(conversationId, files[i]!, controller.signal);
          active = file.id;
          let current = file;
          const deadline = Date.now() + 15 * 60 * 1000;
          while (!["ready", "error"].includes(current.status)) {
            update(
              i,
              current.status === "preparing" ? "Preparing document search…" : current.status,
            );
            await new Promise<void>((resolve, reject) => {
              const abort = () => {
                clearTimeout(timer);
                reject(new Error("Cancelled"));
              };
              const timer = setTimeout(() => {
                controller.signal.removeEventListener("abort", abort);
                resolve();
              }, 700);
              controller.signal.addEventListener("abort", abort, { once: true });
              if (controller.signal.aborted) abort();
            });
            const list = await documents.list(conversationId, controller.signal);
            current = list.find((f) => f.id === file.id) ?? {
              ...file,
              status: "error",
              error: "File removed",
            };
            if (Date.now() > deadline)
              throw new Error("Processing timed out. Retry from the file list.");
          }
          update(
            i,
            current.status === "ready"
              ? "Ready (existing copies are reused)"
              : (current.error ?? "Failed"),
          );
          active = undefined;
        } catch (error) {
          if (controller.signal.aborted && active)
            await documents.cancel(conversationId, active).catch(() => {});
          update(
            i,
            controller.signal.aborted
              ? "Cancelled"
              : error instanceof Error
                ? error.message
                : "Import failed",
          );
        }
        void client.invalidateQueries({ queryKey: ["document-library"] });
        void client.invalidateQueries({ queryKey: ["documents", conversationId] });
      }
    } finally {
      running.current = null;
      setBusy(false);
      void client.invalidateQueries({ queryKey: ["conversations"] });
    }
  }
  return (
    <section
      aria-label="Import files"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void run(Array.from(e.dataTransfer.files));
      }}
      className="rounded border border-dashed border-border p-3 space-y-2"
    >
      <label>
        Upload files
        <input
          aria-label="Upload documents"
          type="file"
          multiple
          accept={fileAccept}
          disabled={busy}
          onChange={(e) => {
            void run(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>
      <input
        ref={folder}
        type="file"
        multiple
        {...{ webkitdirectory: "" }}
        className="hidden"
        disabled={busy}
        aria-label="Import folder"
        onChange={(e) => {
          void run(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="btn-secondary"
        disabled={busy}
        onClick={() => folder.current?.click()}
      >
        Import folder
      </button>
      {busy && (
        <button type="button" className="link-quiet ml-2" onClick={() => running.current?.abort()}>
          Cancel import
        </button>
      )}
      <p className="text-xs text-muted-foreground">
        Drop files here. Folder selection depends on your browser. Up to 100 files per conversation,
        10 MB per file, 1 GB total. Cancel stops remaining work; already imported files are kept.
      </p>
      <ul className="max-h-40 overflow-auto text-xs" aria-live="polite">
        {rows.map((r, i) => (
          <li key={i}>
            {r.name}: {r.status}
          </li>
        ))}
      </ul>
    </section>
  );
}
