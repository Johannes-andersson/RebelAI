import { createFileRoute } from "@tanstack/react-router";
import { handleSystemInfo } from "@/lib/system-info.server";

export const Route = createFileRoute("/api/system")({
  server: { handlers: { GET: () => handleSystemInfo() } },
});
