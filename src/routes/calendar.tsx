import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app-shell";
import { CalendarPage } from "@/components/calendar-page";
export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Rebel AI" },
      { name: "description", content: "Your events, saved privately on this computer." },
    ],
  }),
  component: () => (
    <AppShell>
      <PageHeader title="Calendar" subtitle="Plan your time, privately." />
      <CalendarPage />
    </AppShell>
  ),
});
