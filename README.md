# Rebel AI

A local AI chat prototype built with React and TanStack Start. Chat replies stream
from Ollama through the app's local server, using the existing Rebel AI interface.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/fd29d422-4954-440d-952f-0ad6d0d6cd9d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Local Ollama chat

1. Install and open [Ollama](https://ollama.com), or run `ollama serve` if you use
   the command-line version. The app and Ollama must run on the same computer
   with the default configuration.
2. Make sure the default model is installed: `ollama pull qwen2.5:7b`.
   Use `ollama list` to check what is already available.
3. Optionally copy `.env.example` to `.env.local` and change `OLLAMA_BASE_URL`
   (default: `http://127.0.0.1:11434`). Restart the development server after edits.
   These are server-only settings; do not prefix them with `VITE_`.
4. Run `npm run dev`, then open `/chat` on the local URL printed by Vite.
   The existing Qwen 7B selection is ready to send messages.

The existing selector maps to these Ollama tags. Each tag can be overridden by
the corresponding environment variable in `.env.local` or the server's shell:

| UI selection | Default Ollama tag | Optional override        |
| ------------ | ------------------ | ------------------------ |
| Qwen 7B      | `qwen2.5:7b`       | `OLLAMA_MODEL_QWEN_7B`   |
| Llama 8B     | `llama3.1:8b`      | `OLLAMA_MODEL_LLAMA_8B`  |
| Gemma 9B     | `gemma2:9b`        | `OLLAMA_MODEL_GEMMA_9B`  |
| Qwen 14B     | `qwen2.5:14b`      | `OLLAMA_MODEL_QWEN_14B`  |
| Llama 70B    | `llama3.1:70b`     | `OLLAMA_MODEL_LLAMA_70B` |

Use matching tags to keep the UI labels accurate. Model installation,
settings, and sidebar history are still prototype features. Installing
a model in the UI does not download it into Ollama. The Advanced settings API
address is also still a placeholder; configure the actual address with the
environment variable above.

### Request flow

`ChatPage → ChatRuntime → POST /api/chat → Ollama /api/chat`

`ChatRuntime` accepts a model ID, the current conversation, a text-chunk callback,
and an abort signal. The Ollama-specific request and stream handling are isolated
from the chat UI, so another provider can implement the same interface later.
Conversation messages are held only in page state, with no persistent memory.
Starting a new chat or leaving the page cancels the current request.

The API forwards the response stream without buffering it. Errors such as an
unavailable Ollama service or missing model are shown above the existing composer.
A partial response remains visible if streaming fails, but is excluded from the
next request's conversation context.

This milestone is for local development. A cloud-hosted Lovable server cannot
reach the Ollama service on your computer through its own loopback address.
For a separately launched server, provide `OLLAMA_*` settings in its environment.

## Hardware detection and onboarding

Open `/` and choose **Set up Rebel AI**. The existing setup screens now request
`GET /api/system` from the local app server. They display the actual OS, CPU/chip,
hardware architecture, and total physical memory. The Models page uses the same
result. Failed detection shows an error and retry control, never fabricated hardware.

The server uses Node's built-in `node:os` APIs. On macOS it also runs the fixed,
read-only command `/usr/sbin/sysctl -n hw.optional.arm64` to recognize Apple Silicon
under Rosetta. This uses `execFile` without a shell, with a 1.5-second timeout and
1 KB output limit. No administrator privileges, serial numbers, hostnames, user
files, or external services are involved. An unavailable optional query falls
back to the OS architecture and CPU model; unavailable memory produces an error.

Recommendations are deliberately simple estimates based on **total RAM**, not
available RAM, benchmark results, or GPU memory:

| Total memory  | Tier   | Preferred existing catalog model    |
| ------------- | ------ | ----------------------------------- |
| Below 16 GB   | Small  | Qwen 7B, only if it fits the budget |
| 16–31 GB      | Medium | Qwen 7B                             |
| 32 GB or more | Large  | Qwen 14B                            |

The budget reserves the greater of 4 GB or 25% of RAM for the OS and other apps.
Catalog memory requirements determine fit badges. For example, an 8 GB machine
has no suitable model in the current catalog, while a 16 GB machine has a 12 GB
model budget. Qwen 14B becomes the default at 32 GB; Llama 70B is never selected
automatically. Thresholds use raw bytes; display values use GiB (2^30 bytes),
labeled GB in the existing UI. Speed and capability ratings remain catalog
estimates, and GPU acceleration is explicitly **Not checked**.

Detection describes the **server's computer**, so run the server on the machine
that will run the models. It is not remote browser hardware detection. Local
production builds now use Nitro's Node server preset, retaining access to OS APIs:

```sh
npm run build
HOST=127.0.0.1 PORT=3000 node .output/server/index.mjs
```

For this standalone server, pass any `OLLAMA_*` configuration in its environment.
Cloud/edge deployments are not supported for local hardware detection. The
recommendation does not check installed models or download anything. The later
installation screens are still the original simulated prototype.

### Checks

```sh
npm test
npx tsc --noEmit
npm run build
```

The automated checks use controlled streams and do not require Ollama. To check
the real connection, send a short message in `/chat` and confirm that its answer
appears progressively. A follow-up question should include the current chat's
context. If Ollama is stopped, sending should show instructions to start it and
leave the composer usable.
