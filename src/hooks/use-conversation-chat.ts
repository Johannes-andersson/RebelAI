import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { conversations, conversationKeys } from "@/lib/conversations";
import { chatRuntime, type ChatRequest } from "@/lib/runtime";
import { appStore, applyModelInventory, useAppState } from "@/lib/store";
import { modelManager } from "@/lib/model-manager";
import type { StoredMessage } from "@/lib/types";

export function useConversationChat(id: string | undefined) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const state = useAppState();
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [inventoryReady, setInventoryReady] = useState(false);
  const [inventoryAvailable, setInventoryAvailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const restored = useRef(false);
  const mounted = useRef(true);
  const newId = useRef<string | null>(null);
  const detail = useQuery({
    queryKey: conversationKeys.detail(id),
    enabled: !!id,
    queryFn: ({ signal }) => conversations.get(id!, signal),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.messages.some((m) => m.status === "pending") ? 1000 : false,
  });

  useEffect(() => {
    mounted.current = true;
    setInventoryReady(false);
    setInventoryAvailable(false);
    const controller = new AbortController();
    void modelManager
      .list(controller.signal)
      .then((inventory) => {
        if (controller.signal.aborted) return;
        applyModelInventory(inventory);
        setInventoryAvailable(true);
        setInventoryReady(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Could not check models.");
          setInventoryReady(true);
        }
      });
    return () => {
      mounted.current = false;
      controller.abort();
      request.current?.abort();
      request.current = null;
    };
  }, [retry]);

  useEffect(() => {
    if (detail.data && !request.current) setMessages(detail.data.messages);
  }, [detail.data]);
  useEffect(() => {
    if (!detail.data || !inventoryReady || !inventoryAvailable) return;
    restored.current = true;
    if (detail.data.modelTag) {
      const model = state.installedModels.find((m) => m.tag === detail.data!.modelTag);
      appStore.set({ activeModelId: model?.id ?? "", running: model?.id ?? null });
      if (!model)
        setError(
          `The saved model ${detail.data.modelTag} is not installed. Select another installed model to continue.`,
        );
    }
  }, [detail.data, inventoryReady, inventoryAvailable, state.installedModels]);

  async function send(
    text: string,
    revision?: ChatRequest["revision"],
    onAccepted?: () => void,
    attachments?: ChatRequest["attachments"],
    fileIds?: string[],
  ) {
    const content = text.trim();
    const selected = appStore.get().activeModelId;
    if (
      !inventoryReady ||
      !inventoryAvailable ||
      (!!id && (!restored.current || !detail.data)) ||
      !content ||
      request.current ||
      saving ||
      messages.some((m) => m.status === "pending") ||
      !appStore.get().installed.includes(selected)
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    newId.current ??= crypto.randomUUID();
    const targetId = id ?? newId.current;
    const messageId = crypto.randomUUID();
    const assistantId = `${messageId}:assistant`;
    const common = { conversationId: targetId, createdAt: new Date().toISOString() };
    let accepted = false;
    const accept = () => {
      if (accepted || request.current !== controller || controller.signal.aborted) return;
      accepted = true;
      onAccepted?.();
      setMessages((items) => {
        const index = revision ? items.findIndex((m) => m.id === revision.userMessageId) : -1;
        const before = revision
          ? items
              .slice(0, index + 1)
              .map((m) => (m.id === revision.userMessageId ? { ...m, content } : m))
          : [
              ...items,
              {
                ...common,
                id: messageId,
                role: "user" as const,
                content,
                status: "complete" as const,
              },
            ];
        return [
          ...before,
          { ...common, id: assistantId, role: "assistant", content: "", status: "pending" },
        ];
      });
    };

    setStreaming(assistantId);
    setError(null);
    let firstToken = true;
    try {
      await chatRuntime.streamReply(
        {
          conversationId: targetId,
          messageId,
          newConversation: !id,
          modelId: selected,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          content,
          ...(revision ? { revision } : {}),
          ...(attachments?.length ? { attachments } : {}),
          ...(fileIds?.length ? { fileIds } : {}),
        },
        (chunk) => {
          if (request.current !== controller || controller.signal.aborted) return;
          accept();
          if (firstToken) {
            firstToken = false;
            void client.invalidateQueries({ queryKey: conversationKeys.list });
          }
          setMessages((m) =>
            m.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + chunk }
                : message,
            ),
          );
        },
        controller.signal,
        (webSearch) => {
          accept();
          if (request.current !== controller || controller.signal.aborted) return;
          setMessages((items) =>
            items.map((message) =>
              message.id === assistantId ? { ...message, webSearch } : message,
            ),
          );
        },
        accept,
      );
    } catch (cause) {
      if (request.current === controller && !controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "The reply failed.");
    } finally {
      if (request.current === controller) {
        request.current = null;
        setStreaming(null);
        // The server owns persistence. Reload canonical status even after cancellation.
        const saved = id
          ? await detail.refetch()
          : await conversations
              .get(targetId)
              .then((data) => ({ data, error: null }))
              .catch(() => ({ data: undefined, error: true }));
        // React Query may preserve the old data reference when a request failed
        // before saving anything. Still replace the optimistic pending messages.
        if (mounted.current && !request.current && saved.data && !saved.error)
          setMessages(saved.data.messages);
        if (!id && mounted.current && saved.data) {
          client.setQueryData(conversationKeys.detail(targetId), saved.data);
          void navigate({ to: "/chat", search: { conversation: targetId }, replace: true });
        }
      }
      void client.invalidateQueries({ queryKey: conversationKeys.list });
    }
  }

  async function selectModel(modelId: string) {
    const model = state.installedModels.find((m) => m.id === modelId);
    if (!model || request.current || saving || messages.some((m) => m.status === "pending")) return;
    setSaving(true);
    try {
      if (id) {
        const updated = await conversations.update(id, model.tag);
        client.setQueryData(conversationKeys.detail(id), updated);
      }
      if (!mounted.current) return;
      appStore.set({ activeModelId: modelId, running: modelId });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the model selection.");
    } finally {
      setSaving(false);
    }
  }
  return {
    messages,
    streaming,
    error: error ?? detail.error?.message ?? null,
    loading: !!id && detail.isPending,
    modelLoading: !inventoryReady || !inventoryAvailable,
    saving,
    send,
    selectModel,
    revise: (
      userMessageId: string,
      kind: "regenerate" | "edit",
      text: string,
      onAccepted?: () => void,
    ) => {
      const expectedTailId = messages.at(-1)?.id;
      if (!expectedTailId) return;
      return send(text, { kind, userMessageId, expectedTailId }, onAccepted);
    },
    pending: !!streaming || messages.some((m) => m.status === "pending"),
    stop: () => request.current?.abort(),
    reload: () => {
      setError(null);
      setRetry((value) => value + 1);
      if (id) void detail.refetch();
    },
  };
}
