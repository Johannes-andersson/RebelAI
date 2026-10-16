import { NotificationIndicator } from "./notification-indicator";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { StatusDot, Wordmark } from "@/components/brand";
import { useConversations } from "@/hooks/use-conversations";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useAppState } from "@/lib/store";

const nav = [
  { to: "/chat", label: "Chats" },
  { to: "/models", label: "Models" },
  { to: "/files", label: "Files" },
  { to: "/tasks", label: "Tasks" },
  { to: "/calendar", label: "Calendar" },
  { to: "/settings", label: "Settings" },
] as const;

export function AppShell({ children, onNewChat }: { children: ReactNode; onNewChat?: () => void }) {
  const { running } = useAppState();
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const history = useConversations();
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const entries = history.recent.data?.filter((c) => (showEmpty ? c.isEmpty : !c.isEmpty));
  async function newChat() {
    onNewChat?.();
    try {
      await navigate({ to: "/chat", search: {} });
    } catch {
      /* The sidebar displays the mutation error. */
    }
  }
  async function removeConversation(id: string) {
    try {
      await history.remove.mutateAsync(id);
      setDeleting(null);
      if (search.conversation === id) {
        onNewChat?.();
        await navigate({ to: "/chat", search: {} });
      }
    } catch {
      /* Keep the existing history visible and show the error. */
    }
  }
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel px-3 py-5">
        <Link to="/" className="px-2">
          <Wordmark />
        </Link>
        <button
          onClick={() => {
            void newChat();
          }}
          className="btn-secondary mt-6 h-9 justify-start"
        >
          <span className="text-primary">+</span> New Chat
        </button>
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
        {history.recent.isPending && (
          <p className="px-3 py-2 text-xs text-subtle">Loading conversations…</p>
        )}
        {(history.recent.error ||
          history.create.error ||
          history.remove.error ||
          history.rename.error) && (
          <div role="alert" className="px-3 py-2 text-xs text-destructive">
            {
              (
                history.recent.error ||
                history.create.error ||
                history.remove.error ||
                history.rename.error
              )?.message
            }
            <button
              className="link-quiet mt-1"
              onClick={() => {
                history.create.reset();
                history.remove.reset();
                history.rename.reset();
                void history.recent.refetch();
              }}
            >
              Retry
            </button>
          </div>
        )}
        {history.recent.data?.some((c) => c.isEmpty) && (
          <button className="link-quiet px-3 py-1 text-xs" onClick={() => setShowEmpty(!showEmpty)}>
            {showEmpty ? "Show recent conversations" : "Review empty conversations"}
          </button>
        )}
        <ul className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {entries?.length === 0 && (
            <li className="px-3 py-2 text-xs text-subtle">No conversations yet.</li>
          )}
          {entries?.map((c) => (
            <li key={c.id} className="flex items-center gap-1">
              <Link
                to="/chat"
                search={{ conversation: c.id }}
                aria-current={search.conversation === c.id ? "page" : undefined}
                className={`min-w-0 flex-1 truncate rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground ${search.conversation === c.id ? "bg-accent text-foreground" : ""}`}
              >
                {c.title}
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label={`Conversation options: ${c.title}`}
                    className="rounded px-2 py-1 text-subtle hover:bg-accent focus-visible:outline"
                  >
                    ⋯
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      history.rename.reset();
                      setRenaming({ id: c.id, title: c.title });
                    }}
                  >
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      history.remove.reset();
                      setDeleting(c);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
        <NotificationIndicator />
        <div className="mt-auto flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm">
          <StatusDot tone={running ? "success" : "muted"} />
          {running ? "Local model selected" : "No model selected"}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      <AlertDialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open && !history.rename.isPending) setRenaming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Rename conversation</AlertDialogTitle>
          <AlertDialogDescription>Choose a title up to 100 characters.</AlertDialogDescription>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!renaming || !renaming.title.trim() || history.rename.isPending) return;
              try {
                await history.rename.mutateAsync(renaming);
                setRenaming(null);
              } catch {
                /* Keep the draft available for retry. */
              }
            }}
          >
            <input
              autoFocus
              aria-label="Conversation title"
              maxLength={100}
              className="my-3 w-full rounded border border-border bg-panel p-2"
              value={renaming?.title ?? ""}
              disabled={history.rename.isPending}
              onChange={(e) => {
                if (renaming) setRenaming({ ...renaming, title: e.target.value });
              }}
            />
            {history.rename.error && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {history.rename.error.message}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={history.rename.isPending}>Cancel</AlertDialogCancel>
              <button
                type="submit"
                className="btn-primary"
                disabled={!renaming?.title.trim() || history.rename.isPending}
              >
                {history.rename.isPending ? "Saving…" : "Save title"}
              </button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !history.remove.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Delete conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete “{deleting?.title}” and all its messages from local history? This cannot be
            undone. Files attached only to this conversation will also be removed. Saved calendar
            events are kept.
          </AlertDialogDescription>
          {history.remove.error && (
            <p role="alert" className="text-destructive">
              {history.remove.error.message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={history.remove.isPending}>Cancel</AlertDialogCancel>
            <button
              className="btn-primary"
              disabled={history.remove.isPending}
              onClick={() => {
                if (deleting) void removeConversation(deleting.id);
              }}
            >
              Delete conversation
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
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
