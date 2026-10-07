import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { documents } from "@/lib/documents";
import { conversationKeys } from "@/lib/conversations";
export function useDocuments(id: string | undefined) {
  const client = useQueryClient();
  const key = ["documents", id];
  const query = useQuery({
    queryKey: key,
    enabled: !!id,
    queryFn: ({ signal }) => documents.list(id!, signal),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.some((file) =>
        ["importing", "extracting", "preparing", "indexing"].includes(file.status),
      )
        ? 1500
        : false,
  });
  const search = useQuery({
    queryKey: ["document-search"],
    enabled: !!id && (query.data?.length ?? 0) > 0,
    queryFn: ({ signal }) => documents.searchStatus(signal),
    retry: false,
    // Retrieval can discover a missing component even when every file is ready.
    refetchInterval: 1000,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>) {
    if (!id || busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not process the local attachment.");
    } finally {
      setBusy(false);
      setImporting(null);
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: conversationKeys.detail(id) });
    }
  }
  return {
    files: query.data ?? [],
    preparation: search.data,
    prepareSearch: () =>
      run(async () => {
        const status = await documents.prepareSearch();
        client.setQueryData(["document-search"], status);
      }),
    busy,
    importing,
    error: error ?? query.error?.message,
    upload: (file: File) => {
      if (!id || busy) return;
      setImporting(file.name);
      void run(() => documents.upload(id, file));
    },
    retry: (fileId: string) => run(() => documents.retry(id!, fileId)),
    remove: (fileId: string) => run(() => documents.remove(id!, fileId)),
    reload: () => {
      setError(null);
      void query.refetch();
    },
  };
}
