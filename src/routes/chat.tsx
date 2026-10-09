import { AssistantMessage } from "@/components/assistant-message";
import { CopyButton } from "@/components/copy-button";
import { webAnswerText } from "@/lib/web-search";
import { WebSources } from "@/components/web-sources";
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
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [confirmEdit, setConfirmEdit] = useState(false);
  const following = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (following.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);
  function resend() {
    if (!editing || !editing.text.trim() || chat.pending) return;
    const index = messages.findIndex((m) => m.id === editing.id);
    if (messages.slice(index + 1).some((m) => m.role === "user") && !confirmEdit) {
      setConfirmEdit(true);
      return;
    }
    following.current = true;
    void chat.revise(editing.id, "edit", editing.text, () => {
      setEditing(null);
      setConfirmEdit(false);
    });
  }
  function send() {
    if (
      editing ||
      !input.trim() ||
      !model ||
      chat.loading ||
      chat.modelLoading ||
      chat.pending ||
      chat.saving
    )
      return;
    following.current = true;
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

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onScroll={() => {
          const el = scrollRef.current;
          if (el) following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
        }}
      >
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
            {messages.map((m, index) =>
              m.role === "user" ? (
                <div key={m.id} className="group flex flex-col items-end gap-1 animate-in fade-in">
                  {editing?.id === m.id ? (
                    <div className="w-full rounded-lg border border-border bg-panel p-3">
                      <textarea
                        aria-label="Edit message"
                        autoFocus
                        className="min-h-28 w-full resize-y bg-transparent p-2 outline-none"
                        value={editing.text}
                        disabled={chat.pending}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setEditing(null);
                            setConfirmEdit(false);
                          }
                        }}
                      />
                      {confirmEdit && (
                        <p role="alert" className="mb-2 text-sm text-muted-foreground">
                          Resending this message will permanently remove all later messages and
                          replace its reply.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          className="btn-primary"
                          disabled={!editing.text.trim() || chat.pending}
                          onClick={resend}
                        >
                          {confirmEdit ? "Replace later messages" : "Resend"}
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={chat.pending}
                          onClick={() => {
                            setEditing(null);
                            setConfirmEdit(false);
                          }}
                        >
                          Cancel edit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-panel-raised px-4 py-2.5">
                        {m.content}
                      </p>
                      <button
                        className="link-quiet rounded px-2 py-1 text-xs opacity-70 hover:opacity-100 focus-visible:opacity-100"
                        disabled={chat.pending || chat.modelLoading || chat.saving || !model}
                        onClick={() => {
                          setEditing({ id: m.id, text: m.content });
                          setConfirmEdit(false);
                        }}
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div key={m.id} className="flex gap-4 animate-in fade-in">
                  <span className="mt-1 h-6 w-6 shrink-0 rounded-md bg-primary-soft" />
                  <div className="min-w-0 flex-1">
                    {m.content ? (
                      <AssistantMessage content={m.content} search={m.webSearch} />
                    ) : (
                      <p className="text-subtle">
                        {m.status === "pending" ? "Thinking…" : "No reply was completed."}
                      </p>
                    )}
                    {m.status !== "complete" && m.id !== streaming && (
                      <p className="mt-2 text-xs text-subtle">
                        {m.status === "pending"
                          ? "Generation in progress…"
                          : "Incomplete reply — excluded from future context."}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <CopyButton
                        label="Copy Response"
                        text={webAnswerText(m.content, m.webSearch)}
                      />
                      {index === messages.length - 1 &&
                        messages[index - 1]?.role === "user" &&
                        m.status !== "pending" && (
                          <button
                            className="link-quiet rounded px-2 py-1 focus-visible:outline"
                            disabled={
                              chat.pending ||
                              chat.modelLoading ||
                              chat.saving ||
                              !model ||
                              !!editing
                            }
                            onClick={() => {
                              const user = messages[index - 1]!;
                              following.current = true;
                              void chat.revise(user.id, "regenerate", user.content);
                            }}
                          >
                            {m.status === "complete" ? "Regenerate" : "Retry reply"}
                          </button>
                        )}
                    </div>
                    <MessageSources sources={m.sources} />
                    <WebSources search={m.webSearch} />
                    {m.memoryUsed && m.content && (
                      <p className="mt-2 text-xs text-muted-foreground">Memory used</p>
                    )}
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
            disabled={!!editing}
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
                    !!editing ||
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
