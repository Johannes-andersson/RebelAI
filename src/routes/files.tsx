import { FileLibrary } from "@/components/file-library";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";

export const Route = createFileRoute("/files")({
  head: () => ({
    meta: [
      { title: "Files — Rebel AI" },
      { name: "description", content: "Give your local AI access to your documents, privately." },
      { property: "og:title", content: "Files — Rebel AI" },
      {
        property: "og:description",
        content: "Give your local AI access to your documents, privately.",
      },
    ],
  }),
  component: FilesPage,
});

function FilesPage() {
  return (
    <AppShell>
      <PageHeader
        title="Files"
        subtitle="Let Rebel AI read your documents — they never leave this computer."
      />
      <FileLibrary />
    </AppShell>
  );
}
