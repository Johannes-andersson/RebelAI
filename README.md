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

Prefer working locally? You need Node.js 22.13 or newer and Bun 1.4.2. Bun is the dependency installer; Node runs the app and tests because the server uses `node:sqlite`. Keep `bun.lock` as the single dependency lockfile and use a frozen install to reproduce its versions.

```sh
git clone <this-repository-url>
cd <repository-name>
bun install --frozen-lockfile
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
there is no cloud database, account, or sync. Explicit saved memories use the same database (see below).

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
a separate vector database or automatic conversation-memory extraction.

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

## Explicit local memory

Tell Rebel AI “Remember that…”, “Remember this…”, “Save this to memory…” or
“Keep this in memory…” followed by the information to save. Only these direct
instructions save memory; normal messages are never automatically extracted.
A successful acknowledgement means the text has been saved locally.

Settings → Memory lists saved information, lets you delete individual entries,
and requires confirmation to clear everything. Memory starts enabled. Turning it
off stops capture and recall without removing existing entries; turning it back
on restores their availability. Deleting memories does not delete conversations,
attachments, or text already present in an earlier conversation.

`MemoryRepository` shares the existing `ConversationRepository` SQLite connection
and `conversations.sqlite` file. Additive table creation introduces `memories`,
`memory_settings`, and a small `message_memory_usage` table; existing data needs
no conversion. Deleting a source conversation clears its optional reference but
retains the explicitly saved memory. The same per-OS data directory and
`REBEL_AI_DATA_DIR` override apply.

Memory text is committed before attempting embeddings. The shared local
embedding provider automatically prepares its internal model if needed. If
embedding preparation fails, the saved text remains and a later recall retries
missing embeddings (up to eight per request). No separate embedding dependency,
remote service, or database is introduced.

Recall uses cosine similarity with a 0.50 question threshold and a separate
0.55 writing-preference threshold so preferences such as short answers can apply
across topics. At most three matching memories are included. These configurable
limits live in `src/lib/memory-config.ts`, alongside a 1,000-character per-memory
limit and 500-memory cap. These are simple heuristic thresholds, not a guarantee
that every useful memory will match. Recall has a 30-second budget; errors or
slow initialization skip memory for that reply so ordinary chat can continue.
Memory embeddings and recalled context only use a verified local runtime.

The context builder keeps saved memory, attached-document excerpts, and current
conversation history distinct. “Memory used” means saved context was supplied
for that answer, not proof of how the model used it. This historical indicator
remains on old replies after memory is disabled or cleared. No summarization,
automatic extraction, profiling, categories, cloud sync, or autonomous editing
is implemented.

## Optional automatic web search

Internet access defaults **OFF**. Enable **Settings → Privacy → Allow internet
access** to let Rebel AI look up current information. The setting now lives in
`app_settings` in the existing `conversations.sqlite`, not component state or
localStorage. It persists across navigation, reloads, and app restarts. React
Query provides a central browser API/cache; server rendering uses an OFF/loading
state and hydrates from the local server. Other preferences are not overwritten.

The server checks the stored permission itself. A client flag cannot enable
search. Turning access OFF cancels active searches in this server process and
prevents new ones; OFF is rechecked before accepting results. A provider may
already have received a dispatched query, which cannot be recalled. Results
already supplied to an ongoing model response cannot be removed retroactively.
Run one Rebel AI server per data directory, as with conversation persistence.

### Search provider setup

The default adapter is **Brave Search**, using its documented JSON API instead
of scraping result pages. Configure these **server-only** values in `.env`
and restart the development server:

```dotenv
WEB_SEARCH_PROVIDER=brave
BRAVE_SEARCH_API_KEY=your-key
```

Create a key for the Web Search API through the
[Brave dashboard](https://api-dashboard.search.brave.com/documentation/quickstart).
Provider pricing, credits, and rate limits depend on your plan. The key is sent
only in the provider authorization header, never to the browser or Ollama.
For a production Node launch, supply these as environment variables through your
launcher, or launch from the project directory with
`node --env-file=.env .output/server/index.mjs`. The development server reads `.env`
automatically. Restart after changing it. Never use a `VITE_` prefix for credentials.
The local `.env` file is ignored by Git; `.env.example` contains no credentials.

For a self-hosted option without a paid search API subscription:

```dotenv
WEB_SEARCH_PROVIDER=searxng
SEARXNG_BASE_URL=http://127.0.0.1:8888
```

Use your own SearXNG instance with `json` enabled under `search.formats` in its
`settings.yml`. Rebel AI calls `/search?q=...&format=json&categories=general`.
HTTPS is required unless the instance is on loopback. Many public instances
disable JSON or impose limits; no random public instance is selected for you.
See the [SearXNG Search API](https://docs.searxng.org/dev/search_api.html).
Running SearXNG is optional and is not bundled into Rebel AI. If neither provider
is configured, a clear setup notice appears and the answer remains local.

### Decision, context, and privacy

A small deterministic decision module recognizes freshness terms, weather,
news, prices, current officeholders, and explicit web lookups. Ordinary code,
creative writing, and conversation summaries stay local. Short follow-ups can
use a bounded topic from the immediately preceding user turn in the **same**
conversation. No extra model call is made for classification. Ambiguous requests
fall back to local knowledge; say “Search the web for…” to request a lookup.
These English-language heuristics are intentionally limited and may miss
unusual phrasing or misunderstand a follow-up; there is no autonomous browsing.

Only a compact query (at most 360 characters) is sent to the chosen provider.
Basic secret fields, email addresses, URL parameters, and extra pasted lines are
removed. This is not a comprehensive sensitive-data detector: information you
include in a search question may still reach the provider. Do not put secrets in
search requests. Full transcripts, saved memories, and attached file contents
are never used as outbound search payloads. External providers receive queries
and network metadata; conversation storage and Ollama inference stay local.
Search-enabled turns verify that the selected Ollama runtime/model is local.

Each lookup has a 12-second timeout, a 512 KB response limit, and at most five
validated HTTP(S) sources. There are no automatic retries, page crawls, or
provider redirects. Titles and snippets are bounded and rendered as plain text.
Search results enter temporary context as explicitly **untrusted data**, separate
from application instructions, memories, and document context. The model is told
to ignore instructions in snippets and cite the supplied result numbers. This
reduces prompt-injection risk but cannot guarantee a local model will obey every
instruction or interpret evidence correctly.

“Searching the web…” travels over the existing NDJSON chat stream without being
saved as answer text. After lookup, compact source links and a search date appear
under the answer. These links come only from actual validated provider results;
model-generated URLs are not converted into source links. Snippets are search
summaries, not independently verified full pages or a weather/finance data feed.
Source metadata and failure notices are stored in `message_web_search`, attached
to the existing assistant message and removed when its conversation is deleted.
Raw search results are never inserted into user messages. A source badge means
results were supplied, not a guarantee that every generated claim is supported.

Permission denial, missing credentials, timeouts, rate limits, offline failures,
and empty results show explicit notices with no fake citations. Local replies
are instructed not to present unverified information as current. Switching
conversations or pressing Stop aborts the search/model request and retains the
existing interrupted-message behavior. A search failure does not duplicate or
replace conversation history. No cloud LLM, account, telemetry, or new database
is introduced.

## Optional model controls and response performance

Open **Settings → Models** to configure an installed model. This editor does not
switch the model in an existing conversation; use the Chat model selector for
that. Each exact canonical Ollama tag has its own preferences in the existing
SQLite database (`model_preferences`). Removing a model does not erase its
preferences. **Reset to Default** saves Automatic mode and clears overrides.
Settings affect the next request, including edited and regenerated replies;
already running requests keep their captured settings.

Automatic mode omits `temperature` and `top_p`, preserving the model/runtime's
sampling defaults. It sends a hardware-aware `num_ctx` and a finite
`num_predict` (up to 1,024 tokens, or one quarter of context). Custom mode accepts
temperature 0–2, top-p above 0 through 1, context 512–32,768 tokens within the
model/hardware limit, and output 1–8,192 tokens with room reserved for the prompt.
These are deliberately bounded Rebel AI controls, not the full Ollama option
range. Blank custom fields use automatic/model defaults. All values are validated
server-side; arbitrary browser options are not forwarded to Ollama.

The server checks `/api/tags` and `/api/show` on each inference request. It rejects
missing models, explicitly non-completion models, and cloud-backed models. The
model's architecture-specific context limit is used when available. Older Ollama
versions without capability/context metadata use conservative limits and an
explicit notice; there is no universal per-option capability API. Unsupported
runtime options/errors are surfaced without automatically retrying or silently
changing saved preferences.

Hardware recommendations reuse local OS detection and the onboarding reserve:
at least 4 GiB or 25% of total system RAM. Estimated weights use 1.25× model disk
size. Remaining estimated headroom below 2/4/8/16 GiB permits at most
2,048/4,096/8,192/16,384 tokens respectively; more permits 32,768. The model's
reported limit also caps context. Automatic mode uses at most 8,192; unknown
hardware, size, or model context falls back to 2,048. OS free RAM is a snapshot,
not a reliable measure of reclaimable memory or VRAM. Low free RAM generates a
warning and never silently changes explicit values. Weight estimates exclude
architecture-dependent context caches and runtime overhead, and cannot prevent
all out-of-memory failures. Larger windows do not guarantee long-context quality.

The complete assembled prompt—including search snippets, document context and
existing memory context—is budgeted before inference. The estimate is UTF-8
bytes / 3 plus per-message/template allowances, not an exact tokenizer count.
Space is reserved for maximum output. Older whole turns are omitted first while
preserving application/source context and the newest user turn. Saved SQLite
history is never trimmed. If that fixed context is too large, the request fails
with instructions to shorten it or adjust settings; sources are not silently
removed. Actual tokenization and model templates may differ from the estimate.

**Response performance** below each new assistant reply records its actual model
tag, requested options, measured request time, prompt estimate, and omitted-turn
count in `message_performance` (cascades with message deletion). Ollama's final
`eval_count / eval_duration * 1e9` supplies tokens/second; `total_duration` supplies
runtime duration. These counters are saved only when actually returned. Request
time includes model inspection/loading and inference but excludes prior web
search/retrieval. Cancelled/error replies retain status, elapsed time and any
partial text; no speed is invented. A crash leaves the last saved elapsed-time
checkpoint, not a reconstructed total. Older replies without measurements omit
the view. Both preferences and performance survive local server restarts.

The optional details panel queries `/api/ps` on opening/refresh/save to report a
loaded-model snapshot and Ollama's reported loaded size/context, if available.
It does not infer loading from model selection, measure exact VRAM, or continuously
poll resources. Node OS APIs work on macOS/Windows/Linux; platform support here
uses the existing local Node server, not a new desktop installer.

Ollama references: [runtime options](https://docs.ollama.com/modelfile),
[chat statistics](https://docs.ollama.com/api/chat), and
[loaded models](https://docs.ollama.com/api/ps).

## Local Files library and Calendar

The **Files** page lists actual uploaded PDF, TXT, and Markdown documents across
conversations. Choose an existing conversation or create a new file conversation,
then upload a document. Management reuses chat's upload, indexing, preparation
progress, retry, and removal APIs. **Chat with files** opens the owning conversation;
retrieval does not cross conversation boundaries. Metadata, originals, and indexes
remain in the existing local data directory. Limits remain 10 MB per file and 20
files per conversation. Folder import and OCR are not supported. Removing a file
also removes its saved source excerpts; deleting its conversation removes its files.

**Calendar** offers upcoming/all events, manual create/edit, and confirmed deletion.
The existing SQLite database gains an additive `calendar_events` table and start-date
index. Existing conversations, files, settings, and model preferences are not rewritten.
Timed events store UTC instants and display in the computer's current time zone.
All-day events store date-only values to avoid timezone shifts; optional all-day end
dates are exclusive. An omitted end means no duration has been specified.

**Describe event** is local deterministic assistance, not an Ollama call or an agent.
It supports today/tomorrow, the next occurrence of a named weekday, ISO dates, and
phrases such as "the 1st", with explicit AM/PM or 24-hour times. Bare hours such as
"from 10 to 11" remain blank for clarification. No default duration is invented.
Unsupported/ambiguous dates must be entered manually. This limited English parser
is not general natural-language understanding: review every field, including
month, timezone and daylight-saving transitions. Only **Confirm and save** persists
a draft, and the API validates all data and requires `confirmed: true`. Drafts are
not saved when cancelled. The Calendar page uses this deterministic parser; normal chat additionally supports
reviewed event creation through the local action router described below. There are no notifications, recurrence,
calendar integrations, invites, or cloud synchronization.

Visible branding uses the existing Rebel AI wordmark and a matching original R
favicon (SVG plus legacy ICO fallback). Lovable development/build integration and
repository provenance remain; these are not user-facing product branding.

## Calendar actions from normal chat

Chat routes likely calendar requests through a small application-controlled action
handler before retrieval, memory, or Brave search. A cheap candidate gate avoids
extra inference for unrelated messages; the selected local Ollama model classifies
actual event requests versus hypothetical discussions and extracts bounded JSON
using [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs).
It cannot execute calendar operations. Only the latest user message is provided to
this extractor, not documents or web snippets.

The server supplies its actual current date resolved in the browser's IANA timezone.
Relative/weekday dates and explicit times are resolved in application code; model
normalization is not trusted to invent a missing date or time. Named month dates
without a year use the next occurrence, shown for review. “Next Tuesday” uses the
next Tuesday with an explicit review notice. Unknown dates, bare ambiguous hours,
recurrence and explicit alternative timezones require editing the preview.
No duration is assumed. DST gaps and repeated times require an unambiguous time.
The app currently uses the computer/browser timezone; there is no separate timezone
settings screen. Drafts preserve the timezone in which they were prepared.

Chat previews offer **Confirm event**, **Edit event**, and **Cancel event**. Missing
details open editable clarification fields directly in the preview. Follow-up chat
messages are independent requests; enter clarifications in the preview rather than
expecting a multi-turn planning agent. The existing `/api/calendar` endpoint handles
confirmation and cancellation with strict validation and same-origin checks.

The same SQLite database gains `calendar_actions` (message-linked draft/status) and
`calendar_action_receipts` (one save per originating user message), plus an additive
`location` column on `calendar_events`. Event insertion, the receipt, action status,
and chat confirmation commit atomically. Double-clicks and retries return the same
saved result. Separately submitted confirmations with identical event details reuse
the existing event. Regenerating or editing a previously confirmed turn does not create
a second event; submit a fresh request if you intend another event. Removed previews
cannot be confirmed, cancelled previews remain cancelled, and unconfirmed previews
expire after 24 hours. Deleting chat history does not delete confirmed calendar
events. A saved chat card records the original save even if the event is later edited
or removed in Calendar. No automatic alerts or background reminders are scheduled.

Calendar actions require the selected model to run locally and support structured
JSON output. Extraction failures leave a retryable chat error and never create an
event. Ordinary chat retains the existing streaming, cancellation, history, model
selection, and internet-permission behavior. No external API is used for calendar
classification or creation.
