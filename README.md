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

Prefer working locally? You need Node.js 22.13 or newer and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

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
2. Open `/` to detect hardware, check the recommended model, and install it
   through onboarding. Already installed models can go straight to chat.
3. Optionally copy `.env.example` to `.env.local` and change `OLLAMA_BASE_URL`
   (default: `http://127.0.0.1:11434`). Restart the development server after edits.
   These are server-only settings; do not prefix them with `VITE_`.
4. Run `npm run dev`, then open the local URL printed by Vite. Onboarding selects
   the installed model for chat. `/chat` also refreshes its selector from Ollama.

The existing selector maps to these Ollama tags. Each tag can be overridden by
the corresponding environment variable in `.env.local` or the server's shell:

| UI selection | Default Ollama tag | Optional override        |
| ------------ | ------------------ | ------------------------ |
| Qwen 7B      | `qwen2.5:7b`       | `OLLAMA_MODEL_QWEN_7B`   |
| Llama 8B     | `llama3.1:8b`      | `OLLAMA_MODEL_LLAMA_8B`  |
| Gemma 9B     | `gemma2:9b`        | `OLLAMA_MODEL_GEMMA_9B`  |
| Qwen 14B     | `qwen2.5:14b`      | `OLLAMA_MODEL_QWEN_14B`  |
| Llama 70B    | `llama3.1:70b`     | `OLLAMA_MODEL_LLAMA_70B` |

Use matching tags to keep the UI labels and memory estimates accurate.
Onboarding and Models page installation/removal are real. Settings remain prototype features; conversation history is stored locally in SQLite. The Advanced settings
API address is still a placeholder; configure the actual address with the
environment variable above.

### Request flow

`ChatPage → ChatRuntime → POST /api/chat → Ollama /api/chat`

`ChatRuntime` accepts a model ID, conversation/message IDs, the new user text,
a text-chunk callback, and an abort signal. The server loads prior context. The Ollama-specific request and stream handling are isolated
from the chat UI, so another provider can implement the same interface later.
Conversation messages are saved to local SQLite storage by the server.
Starting a new chat or leaving the page cancels the current request and marks
its partial reply incomplete.

The API checkpoints streamed text to SQLite while forwarding it progressively. Errors such as an
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
Cloud/edge deployments are not supported for local hardware detection.

### Model installation

`Hardware tier → model-config.ts → catalog model ID → configured Ollama tag`

`src/lib/model-config.ts` keeps the small tier-to-model mapping and default Ollama
model tags together. Small and Medium map to Qwen 7B (`qwen2.5:7b`); Large maps to
Qwen 14B (`qwen2.5:14b`). The existing memory-fit checks still apply. Change this
mapping to change future recommendations; the onboarding screens need no changes.
Server environment overrides apply to status checks, pulls, and chat consistently.

`Onboarding → ModelManager → GET /api/models → Ollama GET /api/tags`

The exact tag must be installed: a different size in the same family does not
count. An omitted tag is normalized to `:latest`. Models installed outside the catalog appear by their exact tag on the Models
page and in the chat selector. Ollama reports an error if a selected model does
not support chat. An installed recommendation offers
**Start chatting** immediately; a missing one offers **Install Model**.

`Onboarding → ModelManager → POST /api/models/pull → Ollama POST /api/pull`

The server streams Ollama's newline-delimited progress directly to the browser.
The progress bar shows actual bytes for the current file (Ollama models have
multiple files), followed by verification. There are no simulated timers, speeds,
or completion buttons. After success, another tags check must confirm the exact
model before the app selects it for chat. The `ModelManager` interface keeps
installation separate from screens and the existing `ChatRuntime` interface.

**Cancel** aborts the stream and upstream request. Ollama may retain partial files
for a retry; other clients downloading the same model may continue. Leaving the
setup page also aborts its request. Retry is available after cancellation or errors.
Disk-space messages from Ollama are translated into a clear instruction to free
space on Ollama's drive. There is no speculative free-space check because Ollama
can use a custom model directory or a different computer.

The HTTP installation flow is the same on macOS and Windows. If Ollama cannot be
reached, the server checks executable presence in PATH and standard macOS/Windows
installation locations without running a shell or installing software. This helps
distinguish an app that is not responding from one that was not found. Custom
installation paths cannot be ruled out, and the error text explains that. Users
must install and start Ollama itself; Rebel AI installs models, not the runtime.

The model choice lives in app state for the current session. Reloading chat reads
Ollama's installed models again. No browser persistence or cloud services were added.

## Models page

Open `/models` to load Ollama's actual installed inventory. Installed rows show
exact tags and sizes reported by Ollama (decimal GB), with a **Selected for chat**
label for the current choice. Selection does not claim a model is loaded in memory.
The available cards use the same catalog, tag configuration, and memory-fit
estimates as onboarding. They show every supported uninstalled model, including
those marked not recommended for the current computer.

- **Use in chat** selects an installed model for the current app session.
- **Install** reuses the existing `ModelManager.check/install` flow, streaming
  per-file progress with cancellation and verification. Existing selections are
  preserved when another model is installed.
- **Remove** opens a confirmation dialog naming the exact tag. Only confirmation
  sends a removal request. The app refreshes the inventory after removal and
  selects another installed model if needed; when none remain, chat cannot send.
- **Refresh** reloads changes made outside Rebel AI. Failed refreshes mark existing
  rows as last-known data and disable changes until the service is reachable.

`Models page → ModelManager.list/remove → GET/DELETE /api/models → Ollama /api/tags or /api/delete`

The server deletes the confirmed tag, checks the resulting inventory, and returns
that snapshot. It never reinterprets a confirmed tag using a newer catalog mapping.
The page runs one install/removal at a time, cancels its install on navigation, and
rechecks inventory after ambiguous failures. No running-process management or
model-settings controls are simulated on this page.

Catalog metadata and default model tags live together in `src/lib/model-config.ts`;
`mock-data.ts` re-exports catalog helpers for existing screens. The shared
`applyModelInventory` selection rule handles refreshes and removals consistently.
`ChatRuntime` is unchanged; for installed models outside the catalog, the server
verifies the namespaced model ID against Ollama's inventory before sending chat.
The same HTTP flow works on macOS and Windows without shell deletion commands.

## Persistent local conversations

Chats use Node's built-in `node:sqlite` module (Node **22.13+**; early Node 22
versions label this API experimental). No ORM, database service, or new package is
required. A conversation has an ID, title, timestamps, and its latest selected
model tag. Messages have an ID, conversation ID, role, text, timestamp, and status.

The database is `conversations.sqlite` in:

- macOS: `~/Library/Application Support/Rebel AI/`
- Windows: `%LOCALAPPDATA%\Rebel AI\`
- Linux: `$XDG_DATA_HOME/rebel-ai/`, or `~/.local/share/rebel-ai/`

Override the directory with server-only `REBEL_AI_DATA_DIR` in `.env.local` for
development, or in the environment when starting the production server. Builds
and restarts do not erase the database. Run **one app server per data directory**;
use a separate temporary directory for tests. Database files and WAL sidecars are
ignored by Git. Data remains on disk until the user deletes the conversations;
there is no cloud database, account, sync, or semantic memory.

`Sidebar/chat → conversation client → local API → ConversationRepository → SQLite`

- `GET/POST /api/conversations` lists/creates records.
- `GET/PATCH/DELETE /api/conversations/:id` loads history, updates the model tag,
  or deletes a conversation and its messages in SQLite.
- `POST /api/chat` receives a conversation ID, unique message ID, model ID, and
  new user message. The server reads prior context from SQLite.

Opening `/chat` creates a durable empty conversation and puts its ID in the URL.
Reloading that URL opens the same history. **New Chat** creates another record.
The sidebar shows actual titles and opens each conversation's full history.
Titles use the first user message, with whitespace collapsed and a 60-character
limit, without an extra model request. Deletion requires confirmation. Deleting
the open conversation returns to a fresh empty conversation.

The server saves the user message and a pending assistant record atomically
before calling Ollama. Streamed text is checkpointed before it is forwarded, and
the completed reply is committed before the browser receives `done`. Cancelling,
leaving the page, a broken stream, or a provider failure preserves incomplete
history with a visible label. Incomplete assistant replies are excluded from
later model context. On server restart, remaining pending replies become
interrupted; abrupt termination retains the last committed checkpoint. A unique
pending-reply constraint prevents concurrent generations in one conversation.

The selected model tag is stored and restored per conversation. If that model
has been removed, history still opens and the user can select a replacement.
SQLite stores plain local text, relying on the computer's normal account/file
permissions; this milestone does not add database encryption or backup/export.

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

## Local attachments and retrieval

In a chat, use the paperclip button to attach **PDF, UTF-8 TXT, or Markdown**.
Files appear above the composer with Importing / Extracting / Preparing document search / Indexing / Ready /
Error states. Failed jobs can be retried; Remove deletes the original file,
indexed chunks, vectors, and saved source excerpts. Deleting a conversation also
removes its attachments. Assistant answer text remains part of chat history.

Rebel AI automatically prepares its internal document-search component when the
first valid attachment needs indexing. Normal onboarding and chat without files
do not install or check this component. The UI shows **Preparing document search…**
and real progress for the current download layer. Once verified, indexing resumes
on the original upload. If preparation fails, the file stays attached with a
friendly Retry action; no Terminal command is required.

The internal tag is centrally configured by server-only `OLLAMA_EMBEDDING_MODEL`
(default `embeddinggemma:300m`). It is excluded from the conversational model
inventory and selector, as are embedding-only entries reported by Ollama.
Changing this setting requires reindexing existing attachments via Retry.

Indexing and retrieval verify the exact component locally before use. If it was
removed externally, the next embedding request reinstalls it automatically and
continues. Concurrent callers share one download. Cancelling an individual file
or question stops that caller's wait without cancelling other files' preparation.
Preparation is bounded to 30 minutes; interrupted/failed downloads can be retried
using Ollama's cached layers. Downloading requires internet access for model
weights, but the pull request contains only the model tag, never document text.

`ollama-pull.server.ts` is the shared pull transport and `model-pull-progress.ts`
is the shared progress decoder used by onboarding, Models, and internal search.
`GET /api/document-search` reports progress without initiating an installation;
`POST` starts a user-requested retry. The attachment UI polls this lightweight
status only in conversations with files, including while retrieval is preparing.

Both embedding and attachment-assisted chat require a loopback `OLLAMA_BASE_URL`
and reject Ollama cloud models. All file text and vectors stay on this computer.
Do not expose this unauthenticated local application to a public network.

The original bytes are stored as `REBEL_AI_DATA_DIR/attachments/<UUID>` (or under
the default OS data directory), not inside SQLite. SQLite stores file metadata,
processing states, chunk text, embedding model tags, vectors as JSON arrays, and
per-message source excerpts. Existing conversation databases gain these tables
without altering stored conversations or messages.

The layers are intentionally small:

- `document-storage.server.ts`: bounded uploads and original local files.
- `documents.server.ts`: SQLite attachment/chunk/source records.
- `document-extraction.server.ts`: UTF-8 and local Mozilla PDF.js extraction.
- `document-chunks.ts`: deterministic overlapping text chunks with PDF pages.
- `embeddings.server.ts`: local Ollama `/api/embed`, behind an embedding interface.
- `document-processing.server.ts`: background extraction/indexing and retry.
- `retrieval.server.ts`: conversation-scoped cosine similarity and context text.
- `document-api.server.ts`: local upload/list/retry/remove endpoints.

`POST /api/conversations/:id/documents` takes raw file bytes with an encoded
`X-File-Name` header; GET lists attachments. POST to `.../documents/:documentId`
retries indexing; DELETE removes the attachment. No original-file download route
or global shared file library is added.

Limits: 10 MB and 500,000 extracted characters per file, 500 PDF pages, 20 files
per conversation, and two concurrent processing jobs. Chunks contain up to 1,200
characters with roughly 180 characters of overlap. Indexing batches eight chunks
per Ollama request. Retrieval scans only ready chunks in the current conversation,
selects up to four above a 0.2 cosine score, and never sends whole documents.
This straightforward in-process search suits small local collections; it is not
a vector database or semantic conversation memory.

The existing streamed chat path and normal history are preserved. For attachments,
the server prepends a bounded system context that explicitly treats excerpts as
untrusted evidence, then saves the selected sources before starting the reply.
Completed answers display **Based on: filename**, expandable to exact excerpts
and PDF pages. This records the supplied evidence, not proof every model claim is
correct. Without relevant ready excerpts, the model is told it has no retrieved
file evidence. Broken files remain separate errors and do not poison good indexes.

Only text extraction is supported: scanned/image-only, corrupted, locked, and
unsupported PDFs show clear errors. No OCR or image interpretation is performed.
PDF.js is a server dependency; it reads local bytes, never a document URL.
Interrupted indexing becomes a retryable error after a process restart. Ready
files and indexes survive reloads/restarts. If a local original disappears, the
attachment is marked as an error rather than silently using stale indexed text.
The app still expects one server process per data directory and uses ordinary OS
file permissions rather than encryption at rest.
