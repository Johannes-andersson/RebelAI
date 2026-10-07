import { useState, type ReactNode } from "react";

export function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="link-quiet inline-flex items-center gap-1">
        {label}
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && <div className="mt-4 animate-in fade-in slide-in-from-top-1 duration-300">{children}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors ${checked ? "border-transparent bg-primary" : "border-border-strong bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-foreground transition-all ${checked ? "left-[1.125rem]" : "left-0.5"}`}
      />
    </button>
  );
}

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-mono text-[13px]">{v}</span>
    </div>
  );
}
