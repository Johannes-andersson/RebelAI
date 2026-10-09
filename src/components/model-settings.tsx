import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { modelManager } from "@/lib/model-manager";
import { appStore, useAppState } from "@/lib/store";
import { modelSettings } from "@/lib/generation";
import { type GenerationPreferences, type GenerationProfile } from "@/lib/generation-config";
const field = "h-9 rounded-md border border-input bg-panel px-3 text-sm";
const gib = (bytes: number) => `${(bytes / 2 ** 30).toFixed(1)} GiB`;
export function ModelSettings() {
  const { activeModelId } = useAppState();
  const [selected, setSelected] = useState<string | null>(null);
  const inventory = useQuery({
    queryKey: ["settings-model-inventory"],
    queryFn: ({ signal }) => modelManager.list(signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const models = inventory.data?.installed ?? [];
  const tag = selected ?? models.find((m) => m.id === activeModelId)?.tag ?? models[0]?.tag;
  return (
    <div className="panel space-y-5 p-6">
      <h2 className="font-medium">Model Settings</h2>
      <p className="text-sm text-muted-foreground">
        Optional controls for each local model. Changes apply to its next reply, including edits and
        regeneration. Choose the conversation model in Chat.
      </p>
      <label className="block space-y-2">
        <span>Default model for new chats</span>
        <select
          aria-label="Default model for new chats"
          className={`${field} w-full`}
          value={models.some((m) => m.id === activeModelId) ? activeModelId : ""}
          disabled={!models.length}
          onChange={(e) => appStore.set({ activeModelId: e.target.value, running: e.target.value })}
        >
          {!models.some((m) => m.id === activeModelId) && <option value="">Choose a model</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} · {m.tag}
            </option>
          ))}
        </select>
        <span className="block text-xs text-muted-foreground">
          Existing conversations keep their saved model. This session default is separate from the
          persistent preferences below.
        </span>
      </label>
      <label className="block space-y-2">
        <span>Model to configure</span>
        <select
          aria-label="Model to configure"
          className={`${field} w-full`}
          value={tag ?? ""}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!models.length}
        >
          {!models.length && <option value="">No installed models</option>}
          {selected && !models.some((m) => m.tag === selected) && (
            <option value={selected}>{selected} (not installed)</option>
          )}
          {models.map((m) => (
            <option key={m.tag} value={m.tag}>
              {m.name} · {m.tag}
            </option>
          ))}
        </select>
      </label>
      {inventory.error && <p role="alert">{inventory.error.message}</p>}
      <button className="link-quiet text-sm" onClick={() => void inventory.refetch()}>
        Refresh model list
      </button>
      {tag && <ModelProfile key={tag} tag={tag} />}
    </div>
  );
}
function ModelProfile({ tag }: { tag: string }) {
  const query = useQuery({
    queryKey: ["model-settings", tag],
    queryFn: ({ signal }) => modelSettings(tag, undefined, signal),
    retry: false,
    refetchOnWindowFocus: false,
  });
  return (
    <>
      {query.isPending && <p role="status">Checking model settings…</p>}
      {query.error && <p role="alert">{query.error.message}</p>}
      <button
        className="link-quiet text-sm"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        Refresh model details
      </button>
      {query.data && <SettingsForm profile={query.data} />}
    </>
  );
}
export function SettingsForm({ profile }: { profile: GenerationProfile }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(profile.preferences);
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({
    mutationFn: (value: GenerationPreferences) => modelSettings(profile.tag, value),
    onSuccess: (data) => {
      client.setQueryData(["model-settings", profile.tag], data);
      setDraft(data.preferences);
      setSaved(true);
    },
  });
  const custom = draft.mode === "custom";
  const update = (key: "temperature" | "context" | "maxOutput" | "topP", raw: string) => {
    setSaved(false);
    setDraft((prev) => {
      const value = { ...prev };
      if (raw === "") delete value[key];
      else value[key] = Number(raw);
      return value;
    });
  };
  const input = (
    key: "temperature" | "context" | "maxOutput" | "topP",
    label: string,
    min: number,
    max: number,
    step: number,
    hint: string,
  ) => (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      <input
        type="number"
        aria-label={label}
        className={`${field} w-full`}
        min={min}
        max={max}
        step={step}
        value={draft[key] ?? ""}
        placeholder="Automatic / model default"
        disabled={!custom || mutation.isPending}
        onChange={(e) => update(key, e.target.value)}
      />
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </label>
  );
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate(draft);
      }}
    >
      <label className="block space-y-1">
        <span className="text-sm font-medium">Mode</span>
        <select
          aria-label="Generation mode"
          className={`${field} w-full`}
          value={draft.mode}
          disabled={mutation.isPending}
          onChange={(e) => {
            setSaved(false);
            setDraft({ ...draft, mode: e.target.value as GenerationPreferences["mode"] });
          }}
        >
          <option value="automatic">Automatic</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">
        Automatic: {profile.recommended.toLocaleString()} context tokens; up to{" "}
        {Math.min(1024, Math.floor(profile.recommended / 4))} output tokens. Temperature and top-p
        use the model's defaults. Blank custom fields also use defaults.
      </p>
      {input(
        "temperature",
        "Temperature",
        0,
        2,
        0.05,
        "Lower means more consistent answers; higher allows more variation. Range 0–2.",
      )}
      {input(
        "context",
        "Context window",
        512,
        profile.limit,
        1,
        `Maximum allowed here: ${profile.limit.toLocaleString()} tokens. More context uses more memory and does not guarantee better long-context answers.`,
      )}
      {custom && (
        <div className="flex flex-wrap gap-2">
          {[2048, 4096, 8192, 16384, 32768]
            .filter((n) => n <= profile.limit)
            .map((n) => (
              <button
                key={n}
                type="button"
                className="link-quiet text-xs"
                disabled={mutation.isPending}
                onClick={() => update("context", String(n))}
              >
                {n.toLocaleString()}
              </button>
            ))}
        </div>
      )}
      {input(
        "maxOutput",
        "Maximum output tokens",
        1,
        8192,
        1,
        "Limits the reply, not the whole conversation. Must leave at least 256 context tokens for the prompt; larger prompts need more room.",
      )}
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm font-medium">
          Advanced settings and performance details
        </summary>
        {input(
          "topP",
          "Top-p",
          0.01,
          1,
          0.01,
          "Lower values narrow the words the model considers. Leave blank unless you need to tune it. Range above 0 through 1.",
        )}
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>Model: {profile.tag}</p>
          <p>
            Model size on disk: {profile.sizeBytes === null ? "Unknown" : gib(profile.sizeBytes)}
          </p>
          <p>
            Estimated weight memory:{" "}
            {profile.sizeBytes === null ? "Unknown" : gib(profile.sizeBytes * 1.25)}. Excludes
            context and runtime overhead; not measured VRAM.
          </p>
          <p>
            Total system RAM: {profile.totalBytes === null ? "Unknown" : gib(profile.totalBytes)}.
            Free RAM snapshot: {profile.freeBytes === null ? "Unknown" : gib(profile.freeBytes)}.
            Free RAM excludes reclaimable caches.
          </p>
          <p>
            Model-reported context limit: {profile.modelContext?.toLocaleString() ?? "Unknown"}.
          </p>
          <p>{profile.reason}</p>
          <p>{profile.loadedNotice}</p>
          {profile.loaded && (
            <p>
              Ollama-reported loaded size:{" "}
              {profile.loaded.sizeBytes === null ? "Unknown" : gib(profile.loaded.sizeBytes)};
              loaded context: {profile.loaded.context ?? "Unknown"}. This is a snapshot, not
              continuous monitoring.
            </p>
          )}
        </div>
      </details>
      {profile.warning && <p className="text-sm text-muted-foreground">{profile.warning}</p>}
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error.message}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm">
          Settings saved for {profile.tag}.
        </p>
      )}
      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save settings"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ mode: "automatic" })}
        >
          Reset to Default
        </button>
      </div>
    </form>
  );
}
