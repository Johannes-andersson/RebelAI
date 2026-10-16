import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";
import { TasksPage } from "@/components/tasks-page";
export const Route = createFileRoute("/tasks")({
  component: () => (
    <AppShell>
      <PageHeader title="Tasks" subtitle="Your priorities, kept locally." />
      <TasksPage />
    </AppShell>
  ),
});
