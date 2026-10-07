import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { StatusDot, Wordmark } from "@/components/brand";
import { seedConversations } from "@/lib/mock-data";
import { useAppState } from "@/lib/store";

const nav = [
  { to: "/chat", label: "Chats" },
  { to: "/models", label: "Models" },
  { to: "/files", label: "Files" },
  { to: "/settings", label: "Settings" },
] as const;

export function AppShell({ children, onNewChat }: { children: ReactNode; onNewChat?: () => void }) {
  const { running } = useAppState();
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel px-3 py-5">
        <Link to="/" className="px-2"><Wordmark /></Link>
        <Link to="/chat" onClick={onNewChat} className="btn-secondary mt-6 h-9 justify-start">
          <span className="text-primary">+</span> New Chat
        </Link>
        <nav className="mt-6 space-y-0.5">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="block rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: "bg-accent text-foreground" }}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <p className="eyebrow mt-8 px-3">Recent</p>
        <ul className="mt-2 space-y-0.5">
          {seedConversations.map((c) => (
            <li key={c.id}>
              <Link to="/chat" className="block truncate rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
                {c.title}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm">
          <StatusDot tone={running ? "success" : "muted"} />
          {running ? "Local AI Ready" : "No model running"}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <header className="flex items-end justify-between border-b border-border px-10 pb-6 pt-10">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 text-muted-foreground">{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}
