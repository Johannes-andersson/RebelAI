import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { internet } from "@/lib/internet";
const key = ["internet-permission"];
export function useInternet() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => internet.get(signal),
    retry: false,
    refetchInterval: 2000,
  });
  const mutation = useMutation({
    mutationFn: internet.set,
    onMutate: async () => {
      await client.cancelQueries({ queryKey: key });
    },
    onSuccess: (data) => client.setQueryData(key, data),
  });
  return {
    enabled: query.data?.enabled ?? false,
    loading: query.isPending,
    busy: mutation.isPending,
    error: mutation.error?.message ?? query.error?.message,
    set: (enabled: boolean) => mutation.mutate(enabled),
    retry: () => {
      mutation.reset();
      void query.refetch();
    },
  };
}
