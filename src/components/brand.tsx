export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="relative grid h-6 w-6 place-items-center rounded-md bg-primary text-primary-foreground">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M3 2h6.2a3.6 3.6 0 0 1 1.3 6.95L13 14h-2.6L8.2 9.2H5.4V14H3V2Zm2.4 2.1v3h3.6a1.5 1.5 0 0 0 0-3H5.4Z" />
        </svg>
      </span>
      <span className="font-mono text-xs font-medium tracking-[0.22em]">REBEL AI</span>
    </div>
  );
}

export function StatusDot({ tone = "success" }: { tone?: "success" | "primary" | "muted" }) {
  const cls = tone === "success" ? "bg-success" : tone === "primary" ? "bg-primary" : "bg-subtle";
  return (
    <span className="relative inline-flex h-2 w-2">
      {tone !== "muted" && <span className={`absolute inset-0 animate-ping rounded-full opacity-40 ${cls}`} />}
      <span className={`relative h-2 w-2 rounded-full ${cls}`} />
    </span>
  );
}
