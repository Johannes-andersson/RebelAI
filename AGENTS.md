## Git safety

Do not rewrite published Git history or force-push. Keep the tracked branch in a working state.


## Architecture rules
- Mocked data lives in `src/lib/mock-data.ts` and model replies go through the `ChatRuntime` interface in `src/lib/runtime.ts` — so real Ollama/llama.cpp/FastAPI adapters can replace mocks without touching UI.
- Shared prototype state uses the tiny store in `src/lib/store.ts` — swap for a backend-backed store later.
- Onboarding is a single step machine at `/`; app pages (`/chat`, `/models`, `/files`, `/settings`) wrap content in `AppShell` — keeps the flow simple and the sidebar consistent.
