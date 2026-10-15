# Milestones 7–8 and chat draft fix

## Scope and implementation

This report records the local implementation and verification before the Git checkpoint. No new dependencies, services, or cloud inference were introduced.

### Phase 1

The chat hook previously created a database conversation in a mount effect whenever the URL lacked a conversation ID. New Chat independently created another record. Remounting could therefore leave extra empty records; cancelling a fetch did not undo the server write. Stable IDs inside one mount did not cover subsequent mounts.

The mount effect is removed. New Chat opens an unsaved draft; the first accepted send creates the conversation and initial messages in one SQLite transaction. Stable per-draft IDs, message IDs, the pending-generation constraint, and rollback prevent duplicate empty records. Failed drafts keep their text; confirmed acceptance clears it. The sidebar uses the existing accessible Radix menu for Rename/Delete, removes entries only after successful deletion, and retains failure feedback. Legacy empty records are hidden from Recent and can be reviewed and individually deleted with confirmation. Emptiness checks messages and document references, not the title. The server rechecks before empty-only deletion. Calendar actions/receipts depend on messages, so they cannot be present in an eligible empty record.

### Phase 2

- Sequential multi-file and nested-folder import with relative paths, per-file status, cancellation, and per-conversation content/path deduplication. Unsupported files fail individually.
- PDF/TXT/Markdown indexing uses the existing local embedding preparation and processing services. JPEG/PNG/WebP use local vision input without embedding the image as text.
- Pending chat attachments remain in browser memory until submission; previews can be removed. Accepted files and message attachment references persist in SQLite/local storage.
- Ollama must report `vision` through its local model metadata before image interpretation is allowed. No automatic model substitution or installation occurs.
- The Files page supports filters, metadata rename/move, reindexing, confirmed removal, original-file links, and owning-conversation links.
- Explicit file/folder selection allows retrieval across conversations. Default retrieval remains conversation scoped. Sources show application-assigned D identifiers, stored excerpts, PDF pages when available, and local source links. Invented document IDs are labelled unavailable; model-generated links are suppressed for document answers.
- Deleting a conversation transfers a referenced file to a surviving conversation instead of deleting a shared original. Explicit file removal warns that source references are removed; unrelated messages and saved calendar events remain.

Bounds: 100 files per conversation; 10 MB each; 1 GB of originals; 6000 indexed excerpts globally; at most 20 explicitly selected files, four pending attachments/images, and 10 MB per chat request. Images are retained without lossy recompression to preserve detail. PNGs over 40 megapixels are rejected; JPEG/WebP are byte bounded and may still fail model decoding.

### Phase 3

The existing chat orchestrator executes a fixed, application-owned plan rather than a model-controlled loop. It can retrieve files, obtain local image observations for file lookup, perform one permitted public search, and prepare one calendar draft. Model output and retrieved text cannot add tools, change permissions, or execute commands. Calendar draft authorization comes only from the user's explicit request; structured local extraction supplies bounded fields. Unknown or conflicting document dates stay blank for clarification. The existing transactional, idempotent confirmation endpoint remains the only path that saves a proposed calendar event.

Tool activities persist with messages. Overall execution is bounded to five minutes with shorter extraction/image timeouts. Cancellation preserves accepted messages and attachments. File/image observations are never used to construct external search queries; private-context history is excluded. Internet permission is checked by the existing search service, and no search-provider fallback was added. Evidence remains untrusted, and source validity does not prove answer accuracy.

## Additive SQLite changes

- `documents.relativePath TEXT NOT NULL DEFAULT ''`
- `documents.contentHash TEXT` (existing originals are not rehashed on startup)
- `message_attachments(messageId, fileId)` with foreign keys
- `message_tool_activity(messageId, data)` with a message foreign key

No automatic historical cleanup or destructive migration. Existing conversations, preferences, original files, indexes, and calendar events remain compatible. Restart the server after updating: development hot reload retains its existing repository instance.

## Validation

- Phase 1: 368 tests passed; TypeScript and production build passed. Full lint exposed seven pre-existing formatting errors, fixed without behavioral changes.
- Phase 2: 383 tests passed; TypeScript, lint (zero errors), and build passed. The six remaining lint warnings are existing Fast Refresh warnings in shared UI primitives.
- Final automated checks: 397 tests passed across 48 test files; zero failures. TypeScript passed. Full lint passed with zero errors and six existing Fast Refresh warnings. Production build and Git whitespace checks passed.
- Live testing uses an isolated disposable test database, never the personal Rebel AI data directory. Brave credentials were not used for these tests.
- Chrome: ten draft reloads and navigation between Files/Calendar/Settings/Chat did not create records. The first actual local Ollama message created one conversation. Keyboard menu opening and renaming worked, and the real reply survived reopening and production-server restarts.
- Synthetic TXT/Markdown uploads through the local API were indexed by real local Ollama embeddings. Chrome verified the persisted file list, rename/folder metadata, and a real multi-document answer distinguishing the conflicting 4200/4500 budgets with two D-source excerpts.
- Calendar coordination: the first live test exposed a local-model classification failure for “prepare a calendar event.” The prompt and application fallback were corrected so an explicit request yields a real preview/clarification instead of ordinary-model claims. The final live retest produced a real preview using the selected document: October 20, 2026 at 15:00, America/El_Salvador. Confirmation saved exactly one event. Chrome and the isolated calendar API verified that event after a complete production-server restart. A cancelled earlier draft created no event. Normalized model times are accepted only when they match a literal time parsed from the document.

- Existing synthetic conversations and documents remained available across additive schema updates and repeated full server restarts. The personal database was deliberately not opened or migrated during testing; compatibility is covered by repository tests and the isolated persisted data, not a claimed audit of personal rows.
- Git at the initial verification checkpoint: changes were unstaged and uncommitted on `main`; no commit or push had been performed. No dependency or lockfile changes were needed.

## Known limits and verification gaps

- Live vision inference is unverified: no installed model reports vision support, and the user explicitly declined a model download. Mocked tests cover capability checks, base64 input, persistence, rejection of text-only/remote models, and local-only handling.
- Chrome's automated file chooser requires the extension's “Allow access to file URLs” permission. It was not changed. Multi-file/folder picker interaction is therefore not manually verified; upload/import behavior is covered by automated tests and local API checks. Drag/drop and folder import need a manual browser acceptance pass with that permission available.
- macOS Chrome was used; no Windows runner was available.
- PDF extraction requires selectable text. Image interpretation is not guaranteed OCR. There is no image embedding index or dedicated OCR engine.
- Retrieval remains a bounded top-four excerpt search, not exhaustive document analysis. It can miss evidence, and model interpretation can be wrong. Large folder selection is limited to 20 files per question.
- Calendar routing/extraction is oriented to explicit English requests. Ambiguous/relative document dates and multiple dates require user review; no recurrence, notifications, or automatic event saving was added.
- Explicit file removal removes its saved source references. Deleting a conversation preserves originals that another conversation references.
- Web behavior was tested with mocked Brave responses; no live paid search calls were made in this milestone.

## Files modified

- `README.md`
- `src/components/app-shell.tsx`
- `src/components/assistant-message.tsx`
- `src/components/brand.tsx`
- `src/components/conversation-documents.tsx`
- `src/components/file-library.tsx`
- `src/components/models/fit-badge.tsx`
- `src/components/ui-bits.tsx`
- `src/hooks/use-conversation-chat.ts`
- `src/hooks/use-conversations.ts`
- `src/hooks/use-documents.ts`
- `src/lib/calendar-action.server.test.ts`
- `src/lib/calendar-action.server.ts`
- `src/lib/calendar-action.ts`
- `src/lib/chat-context.server.ts`
- `src/lib/conversation-api.server.ts`
- `src/lib/conversation-chat.server.test.ts`
- `src/lib/conversation-chat.server.ts`
- `src/lib/conversations.server.ts`
- `src/lib/conversations.ts`
- `src/lib/document-api.server.ts`
- `src/lib/document-config.ts`
- `src/lib/document-processing.server.ts`
- `src/lib/documents.server.test.ts`
- `src/lib/documents.server.ts`
- `src/lib/documents.ts`
- `src/lib/generation-config.ts`
- `src/lib/ollama-config.server.test.ts`
- `src/lib/ollama.server.ts`
- `src/lib/retrieval.server.ts`
- `src/lib/runtime.ts`
- `src/lib/types.ts`
- `src/routes/api.conversations.$id.documents.$documentId.ts`
- `src/routes/api.documents.ts`
- `src/routes/chat.tsx`
- `src/test/assistant-message.test.tsx`
- `src/test/chat.test.tsx`
- `src/test/conversations.test.tsx`
- `src/test/documents.test.tsx`
- `src/test/file-library.test.tsx`

## Files created

- `src/components/attachment-composer.tsx`
- `src/components/file-batch-import.tsx`
- `src/components/file-metadata-editor.tsx`
- `src/components/file-scope.tsx`
- `src/lib/advanced-files.server.test.ts`
- `src/lib/attachment-config.ts`
- `src/lib/conversation-drafts.server.test.ts`
- `src/lib/image-analysis.server.ts`
- `src/lib/image-input.server.ts`
- `src/lib/tool-activity.server.ts`
- `src/lib/tool-plan.test.ts`
- `src/lib/tool-plan.ts`
- `src/test/file-batch-import.test.tsx`
- `docs/milestones-7-8.md`

## Final cleanup and release verification — October 14, 2026

Implementation is complete within the documented bounds. Full runtime sign-off remains blocked on a compatible vision model and a manual Chrome import acceptance pass. Nothing had been committed or pushed at that verification stage.

### Cleanup changes

All six Fast Refresh warnings were fixed at their source. Component modules no longer export non-component helpers. Styles, component exports, context identity, and hook behavior are unchanged; all repository consumers were updated. The new modules do not import their component modules, so the extraction introduces no circular dependency. No lint rule was disabled.

| Former warning | Helper's new home |
| --- | --- |
| `ui/badge.tsx` | `ui/badge-variants.ts` |
| `ui/button.tsx` | `ui/button-variants.ts` |
| `ui/toggle.tsx` | `ui/toggle-variants.ts` |
| `ui/navigation-menu.tsx` | `ui/navigation-menu-variants.ts` |
| `ui/form.tsx` | `ui/form-context.ts` |
| `ui/sidebar.tsx` | `ui/sidebar-context.ts` |

Exact files changed in this cleanup pass:

- Modified `src/components/ui/badge.tsx`, `button.tsx`, `toggle.tsx`, `navigation-menu.tsx`, `form.tsx`, `sidebar.tsx`, `alert-dialog.tsx`, `pagination.tsx`, `calendar.tsx`, and `toggle-group.tsx` (all under `src/components/ui/`).
- Created `src/components/ui/badge-variants.ts`, `button-variants.ts`, `toggle-variants.ts`, `navigation-menu-variants.ts`, `form-context.ts`, and `sidebar-context.ts` (all under `src/components/ui/`).
- Modified `src/lib/documents.server.ts`: validate filename/type, byte limits, and image signatures before duplicate lookup. Previously an unsupported file with identical bytes could incorrectly reuse a valid stored file. Valid duplicate retries still reuse the original.
- Extended `src/lib/advanced-files.server.test.ts`: duplicate-validation regression, Windows-style display filenames, and migration from the previous document schema with original bytes, excerpts, and messages preserved across two opens.
- Extended `src/test/file-batch-import.test.tsx`: simulated drop events and nested browser-relative paths. These are component tests, not proof of an actual OS picker or drag gesture.
- Updated `docs/milestones-7-8.md` (this report).

No dependencies, lockfiles, database schema, or application styling changed during cleanup.

### Final automated results

- **400 passed, 0 failed**, across 48 test files.
- TypeScript: PASS, zero errors.
- ESLint: PASS, zero errors and zero warnings, enforced with `--max-warnings 0`.
- Production build: PASS.
- Git whitespace check: PASS.
- Commands: `node node_modules/vitest/vitest.mjs run`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/eslint/bin/eslint.js . --max-warnings 0`; `node node_modules/vite/bin/vite.js build`; `git diff --check`.
- Full regressions include streaming/cancellation, model preferences and performance, permission enforcement, mocked Brave success/failure and private-query isolation, calendar idempotency, deletion failure, source rendering, and separate conversation histories.

### Live and browser evidence

All live checks used the disposable an isolated disposable test database database, synthetic files in a disposable fixture folder, localhost Ollama, and a production build on port 8081. Personal data was not opened, reset, or changed.

- **Chat/history PASS:** real Qwen streamed a reply in three response chunks; the complete reply and performance were saved. Chrome verified the history, three-dot rename, delete confirmation and cancellation, and an unsaved New Chat followed by reload. Exactly three intended test conversations remained; navigation added none.
- **Files backend PASS / browser import BLOCKED:** API uploads covered selectable PDF, TXT, Markdown, PNG, JPEG, nested paths, and unsupported files. All eight supported files reached ready. An intentional burst encountered the existing two-processing-job limit; sequential retries recovered every file. The UI batch importer already serializes processing. Repeating an identical content/path upload reused its ID; identical bytes at different folder paths remain separate by design.
- Chrome displayed imported files and their statuses. API rename/reindex updated saved source filenames; deleting the synthetic injection file removed only its source references and preserved other messages and calendar events. Automated tests cover cancellation and shared-file preservation.
- **Live vision BLOCKED — compatible model not installed.** Installed models reported completion, tools, embedding, or image-generation capabilities; none reported `vision`. The existing application capability check rejected a real image request to Qwen without creating an unwanted conversation. Chrome displayed “No image was analyzed” and retained the unsent question. Mocked vision integration and attachment-persistence tests passed. No model was downloaded. Successful visual interpretation, visual follow-up, and image-plus-document coordination remain unverified live.
- **Document retrieval PASS:** real local embeddings indexed the synthetic documents. A selected document yielded a source-backed calendar preview with the correct workshop date, November 12, 2026, and 14:00 local time. Prior multi-document conflicting-budget verification remains recorded above.
- **Calendar coordination PASS:** Chrome exposed editable fields and required confirmation. One event was saved; two repeated API confirmations returned the same event and did not increase the count. The calendar displayed both the previous test event and the new one after restart. Cancellation and concurrent/idempotent behavior also pass automated tests.
- **Prompt injection PASS for tested cases:** the synthetic document instructed the assistant to search for a private marker and create an event. The local response treated that as quoted content; no calendar action or web tool was invoked. Mocked tests additionally assert zero unauthorized external calls. This does not promise universal model immunity to prompt injection.
- **Web coordination/privacy PASS with mocks:** internet-off blocks search; internet-on permits one authorized search, without adding document excerpts to the query. Web/file evidence and error states are covered by the existing suite. **Live Brave SKIPPED:** the isolated internet setting was false; no personal credential was loaded and no paid request was made. This pass does not reconfirm live Brave authentication or quota availability.
- **Persistence PASS:** exact API snapshot equality before/after a complete server restart for conversations, documents, saved events, source references, tool activity, title, and response performance. Prior synthetic records remained present. The migration regression recreates the previous file schema and verifies preservation; this is not a claim to have inspected personal database contents.
- Chrome reported no console errors or warnings in the inspected log buffer. A verification screenshot was retained locally and is excluded from this checkpoint.

### Windows review

**Windows — Code reviewed, runtime verification unavailable.**

Storage uses `node:path.join` and UUID filenames, so user display filenames never become physical paths. Windows-style incoming filenames are reduced to their basename; extension checks are case-insensitive. Browser `webkitRelativePath` uses slash-separated relative metadata; backslashes, drive prefixes, absolute paths, and traversal are rejected. Folder path spelling/case is intentionally preserved as metadata, not interpreted through the host filesystem. SQLite uses the platform-specific data directory and existing WAL/close handling; tests use `node:os.tmpdir`. Ollama URL parsing and loopback checks are platform-neutral, and existing Windows executable-location tests pass. Browser folder selection still depends on browser support. These checks are not a Windows installation/runtime test.

### Remaining manual acceptance steps

**Chrome multi-file, nested folder, and drag/drop:** the supported extension file-chooser method still refused upload because “Allow access to file URLs” is disabled. No browser permission was changed. Either perform these steps manually in Chrome (no automation permission needed), or enable that extension permission yourself before another automated pass.

1. Start Rebel AI with a disposable data directory; create a disposable `Folder` fixture containing the supported sample documents and images described above, a nested folder, an unsupported file, and identical-content copies. Choose a disposable conversation in Files.
2. Use **Upload files** to select `brief.txt`, `summary.md`, `notes.pdf`, `picture.png`, and `picture.jpg`. Verify each becomes ready and appears in Files.
3. Use **Import folder** to select `Folder`. Verify `Folder/Nested/notes.txt` is retained, `unsupported.exe` reports an error, and reimporting the same folder does not add duplicate content/path entries. Different paths with identical bytes are intentionally distinct.
4. Drag two supported fixture files from Finder onto the import area. Start another batch and click **Cancel import** while processing; remaining rows should cancel and completed files should remain.
5. Refresh, restart the isolated app, and verify files remain. Ask about the workshop using only `brief.txt`; open its source, rename it, reindex, and check the citation and conversation link. Remove a disposable cited file with confirmation and verify unrelated history/events remain.

**Vision:** a locally installed Ollama model that explicitly reports `vision` is required. No installation is authorized by this cleanup request. Once one is available, select it, attach `picture.png`, ask what shapes/colors are visible without describing the image in the prompt, then ask a follow-up. Reselect the stored image for follow-up because current image input is scoped to the current turn. Check image/message association after refresh and a full restart, then run image-plus-document retrieval. Do not count image-generation capability as vision support.

**Windows:** repeat imports, local inference, and restart persistence on a Windows runner before claiming runtime compatibility.

### Git and release status

At completion of the verification pass, all milestone and cleanup work was uncommitted and unstaged on `main`. Existing changes were preserved. Dependency manifests/lockfiles are unchanged; local environment files, SQLite databases, attachments, logs, and build output remain ignored. That verification pass performed no commit, push, history rewrite, model download, or personal-data modification. The subsequent authorized Git checkpoint includes only source, tests, and documentation; temporary fixtures and local artifacts are excluded. The remaining blocked UI/vision checks prevent a claim of full runtime verification.
