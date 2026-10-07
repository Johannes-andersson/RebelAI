import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { memories } from "@/lib/memories";
import type { MemoryState } from "@/lib/memory-config";
const key = ["memories"];
export function useMemories() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => memories.list(signal),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (action: () => Promise<MemoryState>) => action(),
    onSuccess: (state) => client.setQueryData(key, state),
  });
  return {
    state: query.data,
    loading: query.isPending,
    busy: mutation.isPending,
    error: mutation.error?.message ?? query.error?.message,
    reload: () => {
      mutation.reset();
      void query.refetch();
    },
    setEnabled: (enabled: boolean) => mutation.mutateAsync(() => memories.setEnabled(enabled)),
    remove: (id: string) => mutation.mutateAsync(() => memories.remove(id)),
    clear: () => mutation.mutateAsync(() => memories.clear()),
  };
}
