import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Complete, Detect, Install, ModelBrowser, Recommend, Welcome } from "@/components/onboarding/screens";
import { models } from "@/lib/mock-data";
import { useSystemInfo } from "@/hooks/use-system-info";
import { appStore } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rebel AI — Local AI without the technical headache" },
      { name: "description", content: "Set up private AI on your own computer in minutes. No terminal, no config — just install and chat." },
      { property: "og:title", content: "Rebel AI — Local AI without the technical headache" },
      { property: "og:description", content: "Set up private AI on your own computer in minutes. No terminal, no config — just install and chat." },
    ],
  }),
  component: Onboarding,
});

type Step = "welcome" | "detect" | "recommend" | "browse" | "install" | "complete";

function Onboarding() {
  const [step, setStep] = useState<Step>("welcome");
  const [selectedModelId, setModelId] = useState<string | null>(null);
  const hardware = useSystemInfo(step !== "welcome");
  const system = hardware.data;
  const modelId = selectedModelId ?? system?.recommendation.modelId;
  const catalog = models.map((m) => ({ ...m, fit: system?.recommendation.fits[m.id] ?? "not-recommended" as const }));
  const navigate = useNavigate();
  const model = catalog.find((m) => m.id === modelId);

  const finish = useCallback(() => {
    if (!modelId) return;
    const s = appStore.get();
    appStore.set({
      installed: Array.from(new Set([...s.installed, modelId])),
      running: modelId,
      activeModelId: modelId,
    });
    setStep("complete");
  }, [modelId]);

  return (
    <div key={step}>
      {step === "welcome" && <Welcome onStart={() => setStep("detect")} onManual={() => navigate({ to: "/settings" })} />}
      {step === "detect" && <Detect system={system} checking={hardware.isPending || hardware.isFetching} error={hardware.error?.message ?? null} onRetry={() => { void hardware.refetch(); }} onBack={() => setStep("welcome")} onContinue={() => setStep("recommend")} />}
      {step === "recommend" && model && system && (
        <Recommend model={model} system={system} onBack={() => setStep("detect")} onInstall={() => setStep("install")} onBrowse={() => setStep("browse")} />
      )}
      {step === "browse" && (
        <ModelBrowser
          models={catalog}
          onBack={() => setStep("recommend")}
          onPick={(m) => {
            setModelId(m.id);
            setStep("recommend");
          }}
        />
      )}
      {step === "install" && model && <Install model={model} onDone={finish} onCancel={() => setStep("recommend")} />}
      {step === "complete" && model && (
        <Complete model={model} onChat={() => navigate({ to: "/chat" })} onSettings={() => navigate({ to: "/models" })} />
      )}
    </div>
  );
}
