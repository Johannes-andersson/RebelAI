import { useEffect, useRef, useState } from "react";
import { fileAccept } from "@/lib/attachment-config";
export function AttachmentComposer({
  files,
  onChange,
  disabled,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
}) {
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  function add(items: File[]) {
    if (disabled) return;
    const next = [...files, ...items];
    if (next.length > 4 || next.reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024) {
      setError("Attach up to 4 files, totaling at most 10 MB per message.");
      return;
    }
    if (next.some((f) => !f.size || !/\.(pdf|txt|md|markdown|jpg|jpeg|png|webp)$/i.test(f.name))) {
      setError("Choose non-empty PDF, TXT, Markdown, JPEG, PNG, or WebP files.");
      return;
    }
    setError("");
    onChange(next);
  }
  return (
    <div
      className="mb-2 rounded border border-dashed border-border p-2 text-xs"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        add(Array.from(e.dataTransfer.files));
      }}
    >
      <input
        ref={input}
        aria-label="Choose local attachments"
        type="file"
        multiple
        accept={fileAccept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        type="button"
        className="link-quiet"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Attach files or images
      </button>
      <span className="text-muted-foreground"> · or drop here · stays local</span>
      <div className="flex flex-wrap gap-2">
        {files.map((file, i) => (
          <div key={`${file.name}-${i}`} className="p-2">
            <Thumbnail file={file} />
            <span>{file.name}</span>{" "}
            <button
              type="button"
              aria-label={`Remove pending ${file.name}`}
              disabled={disabled}
              onClick={() => onChange(files.filter((_, j) => i !== j))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
function Thumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) return;
    const value = URL.createObjectURL(file);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [file]);
  return url ? (
    <img src={url} alt={`Pending ${file.name}`} className="h-20 max-w-40 object-contain" />
  ) : null;
}
