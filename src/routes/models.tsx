import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/app-shell";
import { StatusDot } from "@/components/brand";
import { FitBadge } from "@/components/models/fit-badge";
import { models } from "@/lib/model-config";
import { useModelLibrary } from "@/hooks/use-model-library";
import type { InstalledModel } from "@/lib/model-manager";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
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
  const { activeModelId } = useAppState();
  const hardware = useSystemInfo();
  const system = hardware.data;
  const library = useModelLibrary();
  const [removing, setRemoving] = useState<InstalledModel | null>(null);
  const mine = library.inventory?.installed ?? [];
  const available = (library.inventory?.supported ?? [])
    .filter((m) => !m.installed)
    .flatMap((status) => {
      const model = models.find((m) => m.id === status.modelId);
      return model
        ? [
            {
              ...model,
              tag: status.tag,
              fit: system?.recommendation.fits[model.id] ?? ("not-recommended" as const),
            },
          ]
        : [];
    });
  const disabled = library.loading || !library.ready || !!library.operation;

  return (
    <AppShell>
      <div className="overflow-y-auto">
        <PageHeader
          title="Models"
          subtitle="Everything here runs on your computer."
          right={
            <div className="panel px-5 py-3 text-right">
              {system ? (
                <>
                  <p className="text-sm font-medium">
                    {system.chip} • {system.memoryGB} GB RAM
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Recommended model tier:{" "}
                    <span className="text-primary">{system.recommendation.tier}</span>
                  </p>
                </>
              ) : hardware.error ? (
                <>
                  <p role="alert" className="text-sm text-destructive">
                    {hardware.error.message}
                  </p>
                  <button
                    className="link-quiet"
                    onClick={() => {
                      void hardware.refetch();
                    }}
                  >
                    Try again
                  </button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Checking hardware…</p>
              )}
            </div>
          }
        />
        <div className="space-y-12 px-10 py-10">
          <div className="flex items-center justify-between gap-4">
            <div>
              {library.loading && (
                <p role="status" className="text-muted-foreground">
                  Checking Ollama…
                </p>
              )}
              {library.error && (
                <p role="alert" className="text-sm text-destructive">
                  {library.error}
                </p>
              )}
              {!library.ready && library.inventory && (
                <p className="text-sm text-subtle">
                  Showing the last known model list. Refresh before making changes.
                </p>
              )}
            </div>
            <button
              className="btn-secondary"
              disabled={library.loading || !!library.operation}
              onClick={() => {
                void library.refresh();
              }}
            >
              Refresh
            </button>
          </div>
          <section>
            <h2 className="eyebrow">Installed Models</h2>
            <div className="mt-4 space-y-3">
              {library.ready && mine.length === 0 && (
                <p className="text-muted-foreground">
                  No models installed yet. Install a model below to start chatting.
                </p>
              )}
              {mine.map((m) => {
                const selected = activeModelId === m.id;
                return (
                  <div
                    key={m.id}
                    className="panel flex flex-wrap items-center justify-between gap-6 px-6 py-5"
                  >
                    <div className="min-w-0">
                      <p className="text-lg font-medium break-all">{m.name}</p>
                      <p className="text-sm text-muted-foreground break-all">{m.tag}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-8">
                      <div className="text-sm">
                        <p className="flex items-center gap-2">
                          <StatusDot tone={selected ? "success" : "muted"} />{" "}
                          {selected ? "Selected for chat" : "Installed"}
                        </p>
                        <p className="font-mono text-xs text-subtle">
                          Storage:{" "}
                          {m.sizeBytes === null
                            ? "Unknown"
                            : `${(m.sizeBytes / 1e9).toFixed(2)} GB`}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="btn-secondary"
                          disabled={disabled || selected}
                          onClick={() => appStore.set({ activeModelId: m.id, running: m.id })}
                        >
                          {selected ? "Selected" : "Use in chat"}
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={disabled}
                          onClick={() => setRemoving(m)}
                        >
                          {library.operation?.kind === "remove" && library.operation.id === m.tag
                            ? "Removing…"
                            : "Remove"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h2 className="eyebrow">Available Models</h2>
            <p className="mt-2 text-sm text-subtle">
              Hardware fit and download sizes are estimates. Installation progress shows each file
              as Ollama downloads it.
            </p>
            {library.ready && available.length === 0 && (
              <p className="mt-4 text-muted-foreground">All supported models are installed.</p>
            )}
            <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
              {available.map((m) => {
                const installing =
                  library.operation?.kind === "install" && library.operation.id === m.id;
                const progress = installing ? library.progress : null;
                return (
                  <div key={m.id} className="panel flex flex-col p-6">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-lg font-medium">{m.name}</p>
                      <FitBadge fit={m.fit} />
                    </div>
                    <p className="mt-2 flex-1 text-sm text-muted-foreground">{m.description}</p>
                    <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
                      {m.tag}
                    </p>
                    <p className="mt-4 font-mono text-xs text-subtle">
                      Approx. {m.sizeGB} GB • {m.speed}
                    </p>
                    {installing ? (
                      <div className="mt-5">
                        <div
                          role="progressbar"
                          aria-label={`Installing ${m.name}`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress?.percent ?? undefined}
                          className="h-1.5 overflow-hidden rounded-full bg-muted"
                        >
                          <div
                            className={`h-full bg-primary transition-[width] ${progress?.percent == null ? "animate-pulse opacity-40" : ""}`}
                            style={{ width: `${progress?.percent ?? 100}%` }}
                          />
                        </div>
                        <p role="status" className="mt-2 text-xs text-muted-foreground">
                          {progress?.label ?? "Connecting to Ollama…"}
                          {progress?.percent != null ? ` — ${progress.percent}%` : ""}
                        </p>
                        {progress?.stage === "download" && (
                          <p className="mt-1 font-mono text-xs text-subtle">
                            Current file: {(progress.completed / 1e9).toFixed(2)} /{" "}
                            {(progress.total / 1e9).toFixed(2)} GB
                          </p>
                        )}
                        <button onClick={library.cancel} className="btn-secondary mt-3 h-9 text-sm">
                          Cancel installation
                        </button>
                      </div>
                    ) : (
                      <button
                        disabled={disabled}
                        onClick={() => {
                          void library.install(m.id);
                        }}
                        className="btn-primary mt-5 h-9 text-sm"
                      >
                        Install
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove model?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {removing?.tag} from Ollama on this computer? You will need to install it again
              to use it. If it is selected, another installed model will be selected for chat.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={disabled}
              onClick={() => {
                if (removing) void library.remove(removing.tag);
              }}
            >
              Remove model
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
