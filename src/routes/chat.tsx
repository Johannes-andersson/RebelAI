import { useDocuments } from "@/hooks/use-documents";
import { ConversationDocuments, MessageSources } from "@/components/conversation-documents";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { StatusDot } from "@/components/brand";

import { useConversationChat } from "@/hooks/use-conversation-chat";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/chat")({
  validateSearch: (search: Record<string, unknown>): { conversation?: string } =>
    typeof search["conversation"] === "string" ? { conversation: search["conversation"] } : {},
  head: () => ({
    meta: [
      { title: "Chat — Rebel AI" },
      { name: "description", content: "Chat privately with AI running on your own computer." },
      { property: "og:title", content: "Chat — Rebel AI" },
      {
        property: "og:description",
        content: "Chat privately with AI running on your own computer.",
      },
    ],
  }),
  component: ChatPage,
});

const suggestions = [
  "Help me code something",
  "Explain something",
  "Write something",
  "Brainstorm an idea",
];

function ChatPage() {
  const { conversation } = Route.useSearch();
  return <ChatSession key={conversation ?? "new"} conversationId={conversation} />;
}

function ChatSession({ conversationId }: { conversationId: string | undefined }) {
  const { activeModelId, installedModels } = useAppState();
  const model = installedModels.find((m) => m.id === activeModelId);
  const modelName = model?.name ?? "No model selected";
  const chat = useConversationChat(conversationId);
  const documents = useDocuments(conversationId);
  const fileInput = useRef<HTMLInputElement>(null);
  const { messages, streaming, error } = chat;
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);
  function send() {
    if (!input.trim() || !model || chat.loading || chat.modelLoading || chat.pending || chat.saving)
      return;
    void chat.send(input);
    setInput("");
  }

  return (
    <AppShell onNewChat={chat.stop}>
      <header className="flex items-center justify-between border-b border-border px-8 py-4">
        <div>
          <h1 className="font-medium">Rebel AI</h1>
          <p className="text-xs text-muted-foreground">{modelName} • Local</p>
        </div>
        <select
          value={activeModelId}
          disabled={
            chat.pending ||
            chat.loading ||
            chat.modelLoading ||
            chat.saving ||
            installedModels.length === 0
          }
          onChange={(e) => {
            void chat.selectModel(e.target.value);
          }}
          className="h-9 rounded-md border border-input bg-panel px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          {!model && (
            <option value="">
              {installedModels.length ? "Select a model" : "No installed model"}
            </option>
          )}
          {installedModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {chat.loading ? (
          <p role="status" className="px-8 py-10 text-muted-foreground">
            Loading conversation…
          </p>
        ) : messages.length === 0 ? (
          <div className="screen-enter flex h-full flex-col items-center justify-center px-8">
            <h2 className="text-4xl font-semibold tracking-tight">What are we building today?</h2>
            <div className="mt-8 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s + " ")}
                  className="btn-secondary h-9 rounded-full px-4"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-8 px-8 py-10">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end animate-in fade-in">
                  <p className="max-w-[80%] rounded-2xl rounded-br-md bg-panel-raised px-4 py-2.5">
                    {m.content}
                  </p>
                </div>
              ) : (
                <div key={m.id} className="flex gap-4 animate-in fade-in">
                  <span className="mt-1 h-6 w-6 shrink-0 rounded-md bg-primary-soft" />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`whitespace-pre-wrap leading-relaxed text-foreground/90 ${streaming === m.id ? "caret" : ""}`}
                    >
                      {m.content || (
                        <span className="text-subtle">
                          {m.status === "pending" ? "Thinking…" : "No reply was completed."}
                        </span>
                      )}
                      {m.status !== "complete" && m.id !== streaming && (
                        <span className="mt-2 block text-xs text-subtle">
                          {m.status === "pending"
                            ? "Generation in progress…"
                            : "Incomplete reply — excluded from future context."}
                        </span>
                      )}
                    </p>
                    <MessageSources sources={m.sources} />
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl px-8 pb-6">
        {!model && (
          <p className="mb-3 text-sm text-muted-foreground">
            Install or select a model on the{" "}
            <a href="/models" className="underline">
              Models page
            </a>{" "}
            to start chatting.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}{" "}
            <button
              className="link-quiet"
              onClick={() => {
                void chat.reload();
              }}
            >
              Reload history
            </button>
          </p>
        )}
        <ConversationDocuments documents={documents} disabled={chat.pending} />
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.txt,.md,.markdown"
          aria-label="Choose local attachment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) documents.upload(file);
            event.target.value = "";
          }}
        />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="panel flex flex-col gap-2 p-3 focus-within:border-border-strong"
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder="Message Rebel AI..."
            className="resize-none bg-transparent px-2 py-1 outline-none placeholder:text-subtle"
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Attach file"
              title="Attach PDF, TXT, or Markdown (up to 10 MB)"
              disabled={!conversationId || chat.loading || chat.pending || documents.busy}
              onClick={() => fileInput.current?.click()}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="m21 12-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7L10 18.4a1.7 1.7 0 0 1-2.3-2.3l8-8" />
              </svg>
            </button>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusDot /> {modelName}
              </span>
              {streaming ? (
                <button
                  type="button"
                  onClick={chat.stop}
                  aria-label="Stop generating"
                  className="btn-primary h-8 w-8 p-0"
                >
                  ■
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={
                    !input.trim() ||
                    chat.pending ||
                    chat.loading ||
                    chat.modelLoading ||
                    chat.saving ||
                    !model
                  }
                  aria-label="Send"
                  className="btn-primary h-8 w-8 p-0"
                >
                  ↑
                </button>
              )}
            </div>
          </div>
        </form>
        <p className="mt-3 text-center text-xs text-subtle">
          {modelName}
          {model ? " • Selected for local chat" : ""}
        </p>
      </div>
    </AppShell>
  );
}
