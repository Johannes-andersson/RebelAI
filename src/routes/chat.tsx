import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusDot } from "@/components/brand";

import { chatRuntime } from "@/lib/runtime";
import { appStore, useAppState, applyModelInventory } from "@/lib/store";
import type { ChatMessage } from "@/lib/types";
import { modelManager } from "@/lib/model-manager";

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Rebel AI" },
      { name: "description", content: "Chat privately with AI running on your own computer." },
      { property: "og:title", content: "Chat — Rebel AI" },
      { property: "og:description", content: "Chat privately with AI running on your own computer." },
    ],
  }),
  component: ChatPage,
});

const suggestions = ["Help me code something", "Explain something", "Write something", "Brainstorm an idea"];

function ChatPage() {
  const { activeModelId, installedModels } = useAppState();
  const model = installedModels.find(m => m.id === activeModelId);
  const modelName = model?.name ?? "No model selected";
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const failedReplies = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void modelManager
      .list(controller.signal)
      .then((status) => {
        if (controller.signal.aborted) return;
        applyModelInventory(status);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "Could not check installed models.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || requestRef.current || !model) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const aiId = crypto.randomUUID();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content };
    const history = [...messages, userMessage].filter((m) => m.content && !failedReplies.current.has(m.id));
    setMessages((m) => [...m, userMessage, { id: aiId, role: "assistant", content: "" }]);
    setInput("");
    setError(null);
    setStreaming(aiId);
    try {
      await chatRuntime.streamReply(
        { modelId: activeModelId, messages: history.map(({ role, content }) => ({ role, content })) },
        (chunk) => {
          if (requestRef.current !== controller || controller.signal.aborted) return;
          setMessages((m) => m.map((msg) => (msg.id === aiId ? { ...msg, content: msg.content + chunk } : msg)));
        },
        controller.signal,
      );
    } catch (cause) {
      if (requestRef.current === controller && !controller.signal.aborted) {
        failedReplies.current.add(aiId);
        setMessages((m) => m.filter((msg) => msg.id !== aiId || msg.content));
        setError(cause instanceof Error ? cause.message : "The reply failed. Please try again.");
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setStreaming(null);
      }
    }
  }

  function newChat() {
    requestRef.current?.abort();
    requestRef.current = null;
    failedReplies.current.clear();
    setMessages([]);
    setStreaming(null);
    setError(null);
  }

  return (
    <AppShell onNewChat={newChat}>
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <div>
          <h1 className="font-medium">Rebel AI</h1>
          <p className="text-xs text-muted-foreground">{modelName} • Local</p>
        </div>
        <select
          value={activeModelId}
          disabled={!!streaming || !model}
          onChange={(e) => appStore.set({ activeModelId: e.target.value, running: e.target.value })}
          className="h-9 rounded-md border border-input bg-panel px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {!model && <option value="">No installed model</option>}
          {installedModels.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="screen-enter flex h-full flex-col items-center justify-center px-8">
            <h2 className="text-4xl font-semibold tracking-tight">What are we building today?</h2>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => setInput(s + " ")} className="btn-secondary h-9 rounded-full px-4">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-8 px-8 py-10">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end animate-in fade-in">
                  <p className="max-w-[80%] rounded-2xl rounded-br-md bg-panel-raised px-4 py-2.5">{m.content}</p>
                </div>
              ) : (
                <div key={m.id} className="flex gap-4 animate-in fade-in">
                  <span className="mt-1 h-6 w-6 shrink-0 rounded-md bg-primary-soft" />
                  <p className={`whitespace-pre-wrap leading-relaxed text-foreground/90 ${streaming === m.id ? "caret" : ""}`}>
                    {m.content || <span className="text-subtle">Thinking…</span>}
                  </p>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl px-8 pb-6">
        {!model && <p className="mb-3 text-sm text-muted-foreground">Install or select a model on the <a href="/models" className="underline">Models page</a> to start chatting.</p>}
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="panel flex flex-col gap-2 p-3 focus-within:border-border-strong"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="Message Rebel AI..."
            className="resize-none bg-transparent px-2 py-1 outline-none placeholder:text-subtle"
          />
          <div className="flex items-center justify-between">
            <button type="button" aria-label="Attach file" className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m21 12-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7L10 18.4a1.7 1.7 0 0 1-2.3-2.3l8-8" /></svg>
            </button>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><StatusDot /> {modelName}</span>
              <button type="submit" disabled={!input.trim() || !!streaming || !model} aria-label="Send" className="btn-primary h-8 w-8 p-0">↑</button>
            </div>
          </div>
        </form>
        <p className="mt-3 text-center text-xs text-subtle">{modelName}{model ? " • Selected for local chat" : ""}</p>
      </div>
    </AppShell>
  );
}
