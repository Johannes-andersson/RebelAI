import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  Complete,
  Detect,
  Install,
  ModelBrowser,
  Recommend,
  Welcome,
} from "@/components/onboarding/screens";
import { models } from "@/lib/mock-data";
import { useSystemInfo } from "@/hooks/use-system-info";
import { appStore } from "@/lib/store";
import { useModelSetup } from "@/hooks/use-model-setup";
import type { ModelAvailability } from "@/lib/model-manager";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rebel AI — Local AI without the technical headache" },
      {
        name: "description",
        content:
          "Set up private AI on your own computer in minutes. No terminal, no config — just install and chat.",
      },
      { property: "og:title", content: "Rebel AI — Local AI without the technical headache" },
      {
        property: "og:description",
        content:
          "Set up private AI on your own computer in minutes. No terminal, no config — just install and chat.",
      },
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
  const catalog = models.map((m) => ({
    ...m,
    fit: system?.recommendation.fits[m.id] ?? ("not-recommended" as const),
  }));
  const navigate = useNavigate();
  const model = catalog.find((m) => m.id === modelId);
  const setup = useModelSetup(modelId ?? null, ["recommend", "install", "complete"].includes(step));

  const finish = useCallback(
    (verified: ModelAvailability, goToChat = false) => {
      if (!modelId || !verified.installed || verified.modelId !== modelId) return;
      appStore.set({
        installed: verified.installedIds,
        running: modelId,
        activeModelId: modelId,
      });
      if (goToChat) void navigate({ to: "/chat" });
      else setStep("complete");
    },
    [modelId, navigate],
  );

  async function startInstall() {
    setStep("install");
    const verified = await setup.install();
    if (verified) finish(verified);
  }

  return (
    <div key={step}>
      {step === "welcome" && (
        <Welcome onStart={() => setStep("detect")} onManual={() => navigate({ to: "/settings" })} />
      )}
      {step === "detect" && (
        <Detect
          system={system}
          checking={hardware.isPending || hardware.isFetching}
          error={hardware.error?.message ?? null}
          onRetry={() => {
            void hardware.refetch();
          }}
          onBack={() => setStep("welcome")}
          onContinue={() => setStep("recommend")}
        />
      )}
      {step === "recommend" && model && system && (
        <Recommend
          model={model}
          system={system}
          phase={setup.phase}
          availability={setup.availability}
          error={setup.error}
          onRetry={() => {
            void setup.check();
          }}
          onUseInstalled={() => {
            if (setup.availability) finish(setup.availability, true);
          }}
          onBack={() => setStep("detect")}
          onInstall={() => {
            void startInstall();
          }}
          onBrowse={() => setStep("browse")}
        />
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
      {step === "install" && model && (
        <Install
          model={model}
          progress={setup.progress}
          phase={setup.phase}
          error={setup.error}
          onRetry={() => {
            void startInstall();
          }}
          onCancel={setup.cancel}
          onBack={() => {
            void setup.check();
            setStep("recommend");
          }}
        />
      )}
      {step === "complete" && model && (
        <Complete
          model={model}
          onChat={() => navigate({ to: "/chat" })}
          onSettings={() => navigate({ to: "/models" })}
        />
      )}
    </div>
  );
}
