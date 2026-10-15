import { useQuery } from "@tanstack/react-query";
import { documents } from "@/lib/documents";
import { isImage } from "@/lib/attachment-config";
export function FileScope({
  ids,
  onChange,
  disabled,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const library = useQuery({
    queryKey: ["document-library"],
    queryFn: ({ signal }) => documents.library(signal),
    retry: false,
  });
  const files = library.data ?? [];
  const folders = [
    ...new Set(files.map((f) => f.relativePath?.split("/").slice(0, -1).join("/")).filter(Boolean)),
  ];
  return (
    <details className="my-2 text-xs">
      <summary className="cursor-pointer">
        Search files: {ids.length ? `${ids.length} selected` : "this conversation"}
      </summary>
      {library.error && <p role="alert">Could not load files.</p>}
      <select
        aria-label="Select file folder"
        disabled={disabled}
        className="bg-panel p-1"
        defaultValue=""
        onChange={(e) => {
          const folder = e.target.value;
          onChange(
            folder
              ? files
                  .filter((f) => f.relativePath?.startsWith(folder + "/"))
                  .slice(0, 20)
                  .map((f) => f.id)
              : [],
          );
        }}
      >
        <option value="">Choose folder (up to 20 files)</option>
        {folders.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="link-quiet ml-2"
        disabled={disabled}
        onClick={() => onChange([])}
      >
        Use conversation files
      </button>
      <div className="max-h-32 overflow-auto">
        {files.map((f) => (
          <label key={f.id} className="block">
            <input
              type="checkbox"
              checked={ids.includes(f.id)}
              disabled={disabled || (!ids.includes(f.id) && ids.length >= 20)}
              onChange={(e) =>
                onChange(e.target.checked ? [...ids, f.id] : ids.filter((id) => id !== f.id))
              }
            />{" "}
            {f.relativePath || f.filename} · {f.status}
          </label>
        ))}
      </div>
      <p>Only selected local files are searched. Excerpts may not cover every page.</p>
    </details>
  );
}
