import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";

export const Route = createFileRoute("/files")({
  head: () => ({
    meta: [
      { title: "Files — Rebel AI" },
      { name: "description", content: "Give your local AI access to your documents, privately." },
      { property: "og:title", content: "Files — Rebel AI" },
      { property: "og:description", content: "Give your local AI access to your documents, privately." },
    ],
  }),
  component: FilesPage,
});

function FilesPage() {
  return (
    <AppShell>
      <PageHeader title="Files" subtitle="Let Rebel AI read your documents — they never leave this computer." />
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="flex w-full max-w-lg flex-col items-center rounded-2xl border border-dashed border-border-strong px-8 py-16 text-center">
          <p className="text-lg font-medium">Coming soon</p>
          <p className="mt-2 text-sm text-muted-foreground">Drop PDFs, notes and folders here to chat with them locally.</p>
        </div>
      </div>
    </AppShell>
  );
}
