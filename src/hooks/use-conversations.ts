import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { conversations, conversationKeys } from "@/lib/conversations";
import type { ConversationSummary } from "@/lib/types";
import { appStore } from "@/lib/store";
export function useConversations() {
  const client = useQueryClient();
  const recent = useQuery({
    queryKey: conversationKeys.list,
    queryFn: ({ signal }) => conversations.list(signal),
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => {
      const state = appStore.get();
      return conversations.create(
        crypto.randomUUID(),
        state.installedModels.find((m) => m.id === state.activeModelId)?.tag ?? null,
      );
    },
    onSuccess: (conversation) => {
      client.setQueryData(conversationKeys.detail(conversation.id), conversation);
      void client.invalidateQueries({ queryKey: conversationKeys.list });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => {
      const item = client
        .getQueryData<ConversationSummary[]>(conversationKeys.list)
        ?.find((c) => c.id === id);
      return conversations.delete(id, item?.isEmpty === true);
    },
    onSuccess: (_, id) => {
      client.setQueryData<ConversationSummary[]>(conversationKeys.list, (items) =>
        items?.filter((item) => item.id !== id),
      );
      client.removeQueries({ queryKey: conversationKeys.detail(id) });
      void client.invalidateQueries({ queryKey: conversationKeys.list });
    },
  });
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => conversations.rename(id, title),
    onSuccess: (conversation) => {
      client.setQueryData(conversationKeys.detail(conversation.id), conversation);
      void client.invalidateQueries({ queryKey: conversationKeys.list });
    },
  });
  return { recent, create, remove, rename };
}
