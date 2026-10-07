import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { StatusDot } from "@/components/brand";
import { FitBadge } from "@/components/models/fit-badge";
import { models } from "@/lib/mock-data";
import { useSystemInfo } from "@/hooks/use-system-info";
import { appStore, useAppState } from "@/lib/store";

export const Route = createFileRoute("/models")({
  head: () => ({
    meta: [
      { title: "Models — Rebel AI" },
      { name: "description", content: "Manage the AI models installed on your computer." },
      { property: "og:title", content: "Models — Rebel AI" },
      { property: "og:description", content: "Manage the AI models installed on your computer." },
    ],
  }),
  component: ModelsPage,
});

function ModelsPage() {
  const { installed, running } = useAppState();
  const hardware = useSystemInfo();
  const system = hardware.data;
  const [progress, setProgress] = useState<Record<string, number>>({});

  function install(id: string) {
    let p = 0;
    const t = setInterval(() => {
      p = Math.min(100, p + 2 + Math.random() * 4);
      setProgress((s) => ({ ...s, [id]: p }));
      if (p >= 100) {
        clearInterval(t);
        appStore.set({ installed: [...appStore.get().installed, id] });
        setProgress(({ [id]: _, ...rest }) => rest);
      }
    }, 100);
  }

  function remove(id: string) {
    const s = appStore.get();
    const left = s.installed.filter((x) => x !== id);
    appStore.set({
      installed: left,
      running: s.running === id ? null : s.running,
      activeModelId: s.activeModelId === id ? (left[0] ?? s.activeModelId) : s.activeModelId,
    });
  }

  const mine = models.filter((m) => installed.includes(m.id));
  const available = models.map((m) => ({ ...m, fit: system?.recommendation.fits[m.id] ?? "not-recommended" as const })).filter((m) => !installed.includes(m.id) && m.fit !== "not-recommended");

  return (
    <AppShell>
      <div className="overflow-y-auto">
        <PageHeader
          title="Models"
          subtitle="Everything here runs on your computer."
          right={
            <div className="panel px-5 py-3 text-right">
              {system ? <>
                <p className="text-sm font-medium">{system.chip} • {system.memoryGB} GB RAM</p>
                <p className="text-xs text-muted-foreground">Recommended model tier: <span className="text-primary">{system.recommendation.tier}</span></p>
              </> : hardware.error ? <>
                <p role="alert" className="text-sm text-destructive">{hardware.error.message}</p>
                <button className="link-quiet" onClick={() => { void hardware.refetch(); }}>Try again</button>
              </> : <p className="text-sm text-muted-foreground">Checking hardware…</p>}
            </div>
          }
        />
        <div className="space-y-12 px-10 py-10">
          <section>
            <h2 className="eyebrow">Installed Models</h2>
            <div className="mt-4 space-y-3">
              {mine.length === 0 && <p className="text-muted-foreground">No models installed yet.</p>}
              {mine.map((m) => {
                const isRunning = running === m.id;
                return (
                  <div key={m.id} className="panel flex items-center justify-between px-6 py-5">
                    <div className="flex items-center gap-6">
                      <div>
                        <p className="text-lg font-medium">{m.name}</p>
                        <p className="text-sm text-muted-foreground">{m.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-8">
                      <div className="text-sm">
                        <p className="flex items-center gap-2"><StatusDot tone={isRunning ? "success" : "muted"} /> {isRunning ? "Running" : "Stopped"}</p>
                        <p className="font-mono text-xs text-subtle">Storage: {m.sizeGB} GB</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-secondary" disabled={isRunning} onClick={() => appStore.set({ running: m.id, activeModelId: m.id })}>Start</button>
                        <button className="btn-secondary" disabled={!isRunning} onClick={() => appStore.set({ running: null })}>Stop</button>
                        <button className="btn-secondary" onClick={() => remove(m.id)}>Remove</button>
                        <button className="btn-secondary" onClick={() => alert(`Settings for ${m.name} — ${m.advanced.parameters}, ${m.advanced.quantization}, ${m.advanced.context} context`)}>Settings</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="eyebrow">Available Models</h2>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {available.map((m) => {
                const p = progress[m.id];
                return (
                  <div key={m.id} className="panel flex flex-col p-6">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-medium">{m.name}</p>
                      <FitBadge fit={m.fit} />
                    </div>
                    <p className="mt-2 flex-1 text-sm text-muted-foreground">{m.description}</p>
                    <p className="mt-4 font-mono text-xs text-subtle">{m.sizeGB} GB • {m.speed}</p>
                    {p !== undefined ? (
                      <div className="mt-5 h-9">
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full bg-primary transition-[width]" style={{ width: `${p}%` }} />
                        </div>
                        <p className="mt-2 font-mono text-xs text-muted-foreground">Installing… {Math.floor(p)}%</p>
                      </div>
                    ) : (
                      <button onClick={() => install(m.id)} className="btn-primary mt-5 h-9 text-sm">Install</button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
