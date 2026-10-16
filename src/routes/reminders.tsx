import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";
import { RemindersPage } from "@/components/reminders-page";
export const Route = createFileRoute("/reminders")({
  component: () => (
    <AppShell>
      <PageHeader title="Reminders" subtitle="Local alerts while Rebel AI is running." />
      <RemindersPage />
    </AppShell>
  ),
});
