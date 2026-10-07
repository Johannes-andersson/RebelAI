import { useEffect, useRef, useState } from "react";
import { Wordmark, StatusDot } from "@/components/brand";
import { FitBadge } from "@/components/models/fit-badge";
import { Disclosure, KeyValue } from "@/components/ui-bits";
import type { ModelInfo, ModelTag, SystemInfo } from "@/lib/types";

export function Welcome({ onStart, onManual }: { onStart: () => void; onManual: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-between px-6 py-10">
      <div />
      <div className="screen-enter flex max-w-xl flex-col items-center text-center">
        <Wordmark />
        <h1 className="mt-14 text-5xl font-semibold tracking-tight">Welcome to Rebel AI</h1>
        <p className="mt-5 text-xl text-foreground/80">Your AI. Your computer. Your data.</p>
        <p className="mt-3 max-w-md text-muted-foreground">
          Run powerful AI models directly on your computer without complicated setup.
        </p>
        <button onClick={onStart} className="btn-primary mt-10 h-12 px-8">Set up Rebel AI</button>
        <button onClick={onManual} className="link-quiet mt-5">I'll configure it manually</button>
      </div>
      <p className="eyebrow">Runs locally • Private by default • Open source</p>
    </div>
  );
}

function Shell({ step, children, onBack }: { step: number; children: React.ReactNode; onBack?: () => void }) {
  return (
    <div className="flex min-h-screen flex-col px-10 py-8">
      <header className="flex items-center justify-between">
        <Wordmark />
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={`h-1 rounded-full transition-all ${i <= step ? "w-6 bg-primary" : "w-3 bg-border-strong"}`} />
          ))}
        </div>
        {onBack ? <button onClick={onBack} className="link-quiet">Back</button> : <span className="w-10" />}
      </header>
      <main className="flex flex-1 items-center justify-center py-12">
        <div className="screen-enter w-full max-w-xl">{children}</div>
      </main>
    </div>
  );
}

export function Detect({ system: s, checking, error, onRetry, onContinue, onBack }: {
  system: SystemInfo | undefined;
  checking: boolean;
  error: string | null;
  onRetry: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  return (
    <Shell step={1} onBack={onBack}>
      <h1 className="text-4xl font-semibold tracking-tight">Let's set up your local AI.</h1>
      <p className="mt-3 text-muted-foreground">We'll check your computer and recommend a model that should run well.</p>

      <section className="panel mt-10 p-6">
        <div className="flex items-center justify-between">
          <h2 className="eyebrow">Your computer</h2>
          {checking ? (
            <span className="flex items-center gap-2 text-sm text-muted-foreground"><StatusDot tone="primary" /> Checking…</span>
          ) : s && !error ? (
            <span className="animate-in fade-in rounded-full bg-success-soft px-3 py-1 text-sm font-medium text-success">✓ Detected</span>
          ) : (
            <span className="text-sm text-destructive">Detection unavailable</span>
          )}
        </div>
        <div className={`mt-5 grid grid-cols-2 gap-x-8 gap-y-3 transition-opacity duration-500 ${checking ? "opacity-30" : ""}`}>
          <p className="text-2xl font-medium">{s?.chip ?? "—"}</p>
          <p className="text-2xl font-medium">{s ? `${s.memoryGB} GB memory` : "—"}</p>
          <p className="text-muted-foreground">{s?.platform ?? "—"}</p>
          <p className="text-muted-foreground">{s?.os ?? "—"}</p>
        </div>
      </section>
      <p className="mt-4 text-sm text-subtle">{s ? `Recommended model tier: ${s.recommendation.tier}. ${s.recommendation.reason}` : "Rebel AI checks the computer running this local app."}</p>
      {error && <div role="alert" className="mt-4 text-sm text-destructive">{error} <button className="btn-secondary mt-2" disabled={checking} onClick={onRetry}>Try again</button></div>}

      <div className="mt-10 flex items-center justify-between">
        <Disclosure label="Advanced system information">
          <div className="panel w-80 divide-y divide-border px-4 py-1">
            <KeyValue k="CPU" v={s?.chip ?? "—"} />
            <KeyValue k="Memory" v={s ? `${s.memoryGB} GB` : "—"} />
            <KeyValue k="Architecture" v={s?.architecture ?? "—"} />
            <KeyValue k="Acceleration" v={s?.acceleration ?? "Not checked"} />
          </div>
        </Disclosure>
        <button onClick={onContinue} disabled={checking || !!error || !s?.recommendation.modelId} className="btn-primary self-start">Continue</button>
      </div>
    </Shell>
  );
}

const ratingWidth = { Excellent: "w-full", Good: "w-2/3", Fair: "w-1/3" } as const;

export function Recommend({
  model,
  system,
  onInstall,
  onBrowse,
  onBack,
}: {
  model: ModelInfo;
  system: SystemInfo;
  onInstall: () => void;
  onBrowse: () => void;
  onBack: () => void;
}) {
  const caps: Array<[string, keyof typeof ratingWidth | "Fast" | "Moderate" | "Slow"]> = [
    ["Chat", model.capabilities.chat],
    ["Writing", model.capabilities.writing],
    ["Coding", model.capabilities.coding],
    ["Reasoning", model.capabilities.reasoning],
    ["Speed", model.speed],
  ];
  const speedW = { Fast: "w-full", Moderate: "w-2/3", Slow: "w-1/3" } as const;
  return (
    <Shell step={2} onBack={onBack}>
      <p className="eyebrow">Recommended for your computer</p>
      <section className="panel mt-4 overflow-hidden">
        <div className="p-8">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-5xl font-semibold tracking-tight">{model.name}</h1>
              <p className="mt-2 font-mono text-sm text-muted-foreground">Approximately {Math.round(model.sizeGB)} GB download</p>
            </div>
            <FitBadge fit={model.fit} />
          </div>
          <p className="mt-6 text-lg text-foreground/85">{model.description}</p>

          <div className="mt-8 space-y-3">
            {caps.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[6rem_1fr_6rem] items-center gap-4 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <span className="h-1 rounded-full bg-muted">
                  <span className={`block h-1 rounded-full bg-primary ${value in ratingWidth ? ratingWidth[value as keyof typeof ratingWidth] : speedW[value as keyof typeof speedW]}`} />
                </span>
                <span className="text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-border bg-panel-raised px-8 py-4 text-sm text-muted-foreground">
          {system.chip} • {system.memoryGB} GB memory • {system.recommendation.tier} tier
        </div>
      </section>
      <p className="mt-4 text-sm text-subtle">{system.recommendation.reason} Model ratings are catalog estimates.</p>

      <div className="mt-8 flex items-center gap-6">
        <button onClick={onInstall} className="btn-primary h-12 px-8">Install Model</button>
        <button onClick={onBrowse} className="link-quiet">Choose another model</button>
      </div>
      <div className="mt-8">
        <Disclosure label="Advanced options">
          <AdvancedOptions model={model} />
        </Disclosure>
      </div>
    </Shell>
  );
}

function AdvancedOptions({ model }: { model: ModelInfo }) {
  const fields: Array<[string, string[]]> = [
    ["Model size", [model.advanced.parameters]],
    ["Quantization", ["Automatic", "Q4", "Q5", "Q8"]],
    ["Context length", ["Automatic", "4K", "8K", "16K"]],
    ["Runtime", ["Automatic", "Ollama", "llama.cpp"]],
  ];
  return (
    <div className="panel p-5">
      <div className="grid grid-cols-2 gap-4">
        {fields.map(([label, opts]) => (
          <label key={label} className="text-sm">
            <span className="text-muted-foreground">{label}</span>
            <select className="mt-1.5 h-9 w-full rounded-md border border-input bg-muted px-2 font-mono text-[13px] outline-none focus:ring-2 focus:ring-ring">
              {opts.map((o) => <option key={o}>{o}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="mt-4 text-sm text-subtle">Not sure what these mean? Leave them on Automatic.</p>
    </div>
  );
}

const filters: Array<{ id: "recommended" | ModelTag | "all"; label: string }> = [
  { id: "recommended", label: "Recommended" },
  { id: "fast", label: "Fast" },
  { id: "coding", label: "Coding" },
  { id: "reasoning", label: "Reasoning" },
  { id: "all", label: "All Models" },
];

export function ModelBrowser({ models, onPick, onBack }: { models: ModelInfo[]; onPick: (m: ModelInfo) => void; onBack: () => void }) {
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const list = models.filter((m) =>
    filter === "all" ? true : filter === "recommended" ? m.fit === "recommended" || m.fit === "good" : m.tags.includes(filter),
  );
  return (
    <Shell step={2} onBack={onBack}>
      <div className="-mx-40">
        <h1 className="text-4xl font-semibold tracking-tight">Choose a model</h1>
        <p className="mt-3 text-muted-foreground">Every model runs privately on your computer. We've estimated what fits your memory budget.</p>
        <div className="mt-8 flex gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`h-8 rounded-full border px-3.5 text-sm transition-colors ${filter === f.id ? "border-primary/40 bg-primary-soft text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4">
          {list.map((m) => (
            <button
              key={m.id}
              onClick={() => onPick(m)}
              disabled={m.fit === "not-recommended"}
              className="panel group p-6 text-left transition-colors hover:border-border-strong disabled:opacity-55"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-xl font-semibold">{m.name}</h3>
                <FitBadge fit={m.fit} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{m.description}</p>
              <div className="mt-6 grid grid-cols-3 gap-2 font-mono text-xs text-subtle">
                <span>{m.sizeGB} GB download</span>
                <span>{m.speed}</span>
                <span>Needs {m.memoryGB} GB</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </Shell>
  );
}

const stages = ["Checking system", "Preparing local AI engine", "Downloading model", "Optimizing model", "Ready"];

export function Install({ model, onDone, onCancel }: { model: ModelInfo; onDone: () => void; onCancel: () => void }) {
  const [pct, setPct] = useState(0);
  const [paused, setPaused] = useState(false);
  const [canFinish, setCanFinish] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setCanFinish(true), 3500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setPct((p) => Math.min(100, p + 0.4 + Math.random() * 1.1)), 90);
    return () => clearInterval(id);
  }, [paused]);
  useEffect(() => {
    if (pct >= 100 && !doneRef.current) {
      doneRef.current = true;
      setTimeout(onDone, 700);
    }
  }, [pct, onDone]);

  const stageIdx = pct < 6 ? 0 : pct < 14 ? 1 : pct < 88 ? 2 : pct < 100 ? 3 : 4;
  const dlPct = Math.min(100, Math.max(0, ((pct - 14) / 74) * 100));
  const label = stageIdx <= 1 ? stages[stageIdx] : stageIdx === 2 ? "Downloading model" : stageIdx === 3 ? "Optimizing model" : "Ready";

  return (
    <Shell step={3}>
      <h1 className="text-4xl font-semibold tracking-tight">Installing {model.name}</h1>
      <section className="panel mt-10 p-7">
        <div className="flex items-baseline justify-between">
          <span className="text-sm">{paused ? "Paused" : label}</span>
          <span className="font-mono text-3xl font-medium tabular-nums">{Math.floor(pct)}%</span>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-muted">
          <div className="relative h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${pct}%` }}>
            {!paused && <div className="progress-sheen absolute inset-0" />}
          </div>
        </div>
        <p className="mt-3 font-mono text-xs text-subtle tabular-nums">
          {((dlPct / 100) * model.sizeGB).toFixed(1)} GB / {model.sizeGB.toFixed(1)} GB
        </p>

        <ol className="mt-8 space-y-3">
          {stages.map((s, i) => (
            <li key={s} className={`flex items-center gap-3 text-sm ${i < stageIdx ? "text-foreground" : i === stageIdx ? "text-primary" : "text-subtle"}`}>
              <span className="w-4 text-center font-mono">{i < stageIdx || stageIdx === 4 ? "✓" : i === stageIdx ? "→" : "○"}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>
      <p className="mt-4 text-sm text-muted-foreground">You can continue using your computer while Rebel AI finishes setup.</p>
      <div className="mt-8 flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={() => setPaused((p) => !p)} className="btn-secondary">{paused ? "Resume" : "Pause"}</button>
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
        </div>
        {canFinish && (
          <button onClick={() => setPct(100)} className="btn-primary animate-in fade-in">Finish Installation</button>
        )}
      </div>
    </Shell>
  );
}

export function Complete({ model, onChat, onSettings }: { model: ModelInfo; onChat: () => void; onSettings: () => void }) {
  return (
    <Shell step={4}>
      <div className="flex flex-col items-center text-center">
        <div className="relative grid h-20 w-20 place-items-center">
          <span className="success-ring absolute inset-0 rounded-full border border-success" />
          <span className="grid h-16 w-16 place-items-center rounded-full bg-success-soft text-2xl text-success animate-in zoom-in-50 duration-500">✓</span>
        </div>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">Your local AI is ready.</h1>
        <div className="panel mt-8 flex w-80 items-center justify-between px-5 py-4 text-left">
          <div>
            <p className="font-medium">{model.name}</p>
            <p className="text-sm text-muted-foreground">Running locally</p>
          </div>
          <span className="flex items-center gap-2 text-sm text-success"><StatusDot /> Local</span>
        </div>
        <p className="mt-6 max-w-sm text-muted-foreground">Everything is ready. Your conversations can now stay on your computer.</p>
        <button onClick={onChat} className="btn-primary mt-10 h-12 px-8">Start chatting</button>
        <button onClick={onSettings} className="link-quiet mt-4">View model settings</button>
      </div>
    </Shell>
  );
}
