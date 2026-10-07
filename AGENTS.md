<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Mocked data lives in `src/lib/mock-data.ts` and model replies go through the `ChatRuntime` interface in `src/lib/runtime.ts` — so real Ollama/llama.cpp/FastAPI adapters can replace mocks without touching UI.
- Shared prototype state uses the tiny store in `src/lib/store.ts` — swap for a backend-backed store later.
- Onboarding is a single step machine at `/`; app pages (`/chat`, `/models`, `/files`, `/settings`) wrap content in `AppShell` — keeps the flow simple and the sidebar consistent.
