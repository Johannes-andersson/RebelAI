import { useEffect, useRef, useState } from "react";
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="link-quiet rounded px-2 py-1 text-xs focus-visible:outline"
        disabled={!text}
        onClick={async () => {
          clearTimeout(timer.current);
          try {
            await navigator.clipboard.writeText(text);
            setStatus("Copied");
            timer.current = setTimeout(() => setStatus(""), 2000);
          } catch {
            setStatus("Could not copy. Select the text and copy manually.");
          }
        }}
      >
        {label}
      </button>
      <span role="status" className="text-xs text-muted-foreground">
        {status}
      </span>
    </span>
  );
}
