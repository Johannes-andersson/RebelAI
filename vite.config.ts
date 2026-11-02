import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig(({ mode, command }) => {
  // These settings remain server-side; only VITE_* variables reach the browser.
  const serverEnv = loadEnv(mode, process.cwd(), [
    "OLLAMA_",
    "REBEL_AI_",
    "WEB_SEARCH_",
    "BRAVE_SEARCH_",
    "SEARXNG_",
  ]);
  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] ??= value;
  }
  return {
    server: { host: "127.0.0.1", port: 8080 },
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },
    plugins: [
      tsConfigPaths({ projects: ["./tsconfig.json"] }),
      tanstackStart({
        server: { entry: "server" },
        importProtection: {
          behavior: "error",
          client: { files: ["**/server/**"], specifiers: ["server-only"] },
        },
      }),
      ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
      react(),
      tailwindcss(),
    ],
  };
});
