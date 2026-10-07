import { useQuery } from "@tanstack/react-query";
import type { SystemInfo } from "@/lib/types";

export function useSystemInfo(enabled = true) {
  return useQuery<SystemInfo>({
    queryKey: ["system-info"],
    enabled,
    staleTime: Infinity,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/system", {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        cache: "no-store",
      }).catch(() => {
        throw new Error(
          "Cannot detect your computer. Check that the local Rebel AI server is running, then try again.",
        );
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Hardware detection failed. Please try again.");
      }
      return response.json();
    },
  });
}
