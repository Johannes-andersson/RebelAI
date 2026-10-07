import { MemorySettings } from "@/components/memory-settings";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Toggle } from "@/components/ui-bits";
import { getModel, models } from "@/lib/mock-data";
import { appStore, useAppState } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Rebel AI" },
      { name: "description", content: "Privacy-first settings for your local AI workspace." },
      { property: "og:title", content: "Settings — Rebel AI" },
      { property: "og:description", content: "Privacy-first settings for your local AI workspace." },
    ],
  }),
  component: SettingsPage,
});

const tabs = ["General", "Models", "Memory", "Privacy", "Advanced"] as const;
type Tab = (typeof tabs)[number];

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 border-b border-border py-5 last:border-0">
      <div>
        <p className="font-medium">{title}</p>
        {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

const field = "h-9 rounded-md border border-input bg-muted px-3 text-sm outline-none focus:ring-2 focus:ring-ring";

function SettingsPage() {
  const [tab, setTab] = useState<Tab>("General");
  const [t, setT] = useState({ local: true, internet: false, diagnostics: false, launch: true, dev: false });
  const [advOpen, setAdvOpen] = useState(false);
  const { activeModelId, installed } = useAppState();

  return (
    <AppShell>
      <PageHeader title="Settings" />
      <div className="flex flex-1 overflow-hidden">
        <nav className="w-52 shrink-0 space-y-0.5 px-6 py-8">
          {tabs.map((x) => (
            <button
              key={x}
              onClick={() => setTab(x)}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${tab === x ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              {x}
            </button>
          ))}
        </nav>
        <div key={tab} className="screen-enter max-w-2xl flex-1 overflow-y-auto px-4 py-8">
          {tab === "General" && (
            <div className="panel px-6">
              <Row title="Open Rebel AI at login"><Toggle label="Open at login" checked={t.launch} onChange={(v) => setT({ ...t, launch: v })} /></Row>
              <Row title="Language"><select className={field}><option>English</option><option>Español</option></select></Row>
            </div>
          )}
          {tab === "Models" && (
            <div className="panel px-6">
              <Row title="Default model" desc="Used for new chats.">
                <select className={field} value={activeModelId} onChange={(e) => appStore.set({ activeModelId: e.target.value })}>
                  {models.filter((m) => installed.includes(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Row>
              <Row title="Storage used" desc="Where your models live on disk.">
                <span className="font-mono text-sm">{installed.reduce((a, id) => a + getModel(id).sizeGB, 0).toFixed(1)} GB</span>
              </Row>
            </div>
          )}
          {tab === "Memory" && <MemorySettings />}
          {tab === "Privacy" && (
            <>
              <div className="mb-6 rounded-xl border border-primary/25 bg-primary-soft px-6 py-5">
                <p className="font-medium text-primary">Private by default</p>
                <p className="mt-1 text-sm text-foreground/85">Rebel AI is designed to keep your conversations and models on your computer.</p>
              </div>
              <div className="panel px-6">
                <Row title="Store chats locally" desc="Conversations are saved only on this computer."><Toggle label="Store chats locally" checked={t.local} onChange={(v) => setT({ ...t, local: v })} /></Row>
                <Row title="Allow internet access" desc="Let models look things up online."><Toggle label="Allow internet access" checked={t.internet} onChange={(v) => setT({ ...t, internet: v })} /></Row>
                <Row title="Share diagnostics" desc="Anonymous crash reports to help improve Rebel AI."><Toggle label="Share diagnostics" checked={t.diagnostics} onChange={(v) => setT({ ...t, diagnostics: v })} /></Row>
              </div>
            </>
          )}
          {tab === "Advanced" &&
            (!advOpen ? (
              <div className="panel p-8 text-center">
                <p className="font-medium">Advanced settings</p>
                <p className="mt-2 text-sm text-muted-foreground">Most people never need these. Rebel AI handles everything automatically.</p>
                <button onClick={() => setAdvOpen(true)} className="btn-secondary mt-6">Show advanced settings</button>
              </div>
            ) : (
              <div className="panel px-6">
                <Row title="Local API address" desc="OpenAI-compatible endpoint for other apps."><input className={`${field} w-56 font-mono`} defaultValue="http://127.0.0.1:11434" /></Row>
                <Row title="Model runtime"><select className={field}><option>Automatic</option><option>Ollama</option><option>llama.cpp</option></select></Row>
                <Row title="Developer mode" desc="Show logs and raw model parameters."><Toggle label="Developer mode" checked={t.dev} onChange={(v) => setT({ ...t, dev: v })} /></Row>
              </div>
            ))}
        </div>
      </div>
    </AppShell>
  );
}
