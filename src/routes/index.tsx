import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Complete, Detect, Install, ModelBrowser, Recommend, Welcome } from "@/components/onboarding/screens";
import { getModel } from "@/lib/mock-data";
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
  const [modelId, setModelId] = useState("qwen-7b");
  const navigate = useNavigate();
  const model = getModel(modelId);

  const finish = useCallback(() => {
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
      {step === "detect" && <Detect onBack={() => setStep("welcome")} onContinue={() => setStep("recommend")} />}
      {step === "recommend" && (
        <Recommend model={model} onBack={() => setStep("detect")} onInstall={() => setStep("install")} onBrowse={() => setStep("browse")} />
      )}
      {step === "browse" && (
        <ModelBrowser
          onBack={() => setStep("recommend")}
          onPick={(m) => {
            setModelId(m.id);
            setStep("recommend");
          }}
        />
      )}
      {step === "install" && <Install model={model} onDone={finish} onCancel={() => setStep("recommend")} />}
      {step === "complete" && (
        <Complete model={model} onChat={() => navigate({ to: "/chat" })} onSettings={() => navigate({ to: "/models" })} />
      )}
    </div>
  );
}
