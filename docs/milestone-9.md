# Milestone 9 — Personal assistant

## Scope and architecture

The existing React/TanStack Start application, local Ollama provider, SQLite
connection, chat stream, and calendar are extended in place. No dependency,
background service, cloud API, or second calendar implementation was added.
All records use the existing per-OS application data directory and optional
`REBEL_AI_DATA_DIR` override. Tests use disposable synthetic data only.

Tasks has project management, descriptions/notes, priorities, due date/time,
completion, filtering and sorting. Completed tasks remain stored. Chat can read
local tasks and prepare editable create/update/complete/move/delete actions.
Ambiguous matches ask for clarification. Projects are managed in Tasks.

Calendar adds daily, weekly, selected-weekday and monthly rules, optional until
and count, and saved IANA timezones. Occurrences are generated on demand, never
stored as an infinite series. The UI displays a movable 90-day window; server
queries are bounded to 366 days and 2,000 returned occurrences. Impossible days
(e.g. the 31st in February) are skipped. DST gaps and folds are skipped with notices;
initial ambiguous/nonexistent times are rejected. Times do not silently shift.
Occurrence edits/cancellations are exceptions keyed by series/date. Editing the
whole series resets exceptions, disclosed in the form. “This and future” is
explicitly disabled. Deleting a series removes its exceptions.

Reminders can be standalone or attached to timed tasks/events, with lead time,
recurrence, enable/disable, history, acknowledge/dismiss and default lead settings.
Tasks without a due time and all-day events require a separate timed reminder.
Settings → Memory now supports search, categories, editing and confirmed deletion.
Chat memory mutations use persisted editable confirmation cards. Ordinary messages
are never automatically extracted into saved memories.

## Storage and APIs

Additive schema creation preserves existing records:

- `task_projects`, `tasks`, `task_actions`, `task_receipts`.
- `calendar_events` gains recurrence/timezone; `calendar_exceptions` stores edits
  and cancellations. Existing calendar actions/receipts are reused.
- `reminders`, `reminder_deliveries`, `reminder_settings`, `reminder_actions`,
  `reminder_receipts`.
- `memories` gains category; `memory_actions`, `memory_receipts` preserve decisions.

New `/api/tasks` and `/api/reminders` routes use the same same-origin checks,
validated JSON, parameterized SQLite statements and error handling as existing
routes. `/api/calendar` adds bounded occurrence queries and exception writes.
`/api/memories` adds action decisions; the existing item route supports updates.
Task and memory edits check versions/timestamps. Confirmations use transactional
receipts so retries/regeneration cannot repeat already handled actions. Pending
cards expire after 24 hours. Cancelled calendar decisions also retain receipts.

UI requests go through small client services; persistence stays in repositories.
Conversation loading includes pending/completed action metadata, so cards survive
reloads and restart. The same assistant reply may carry independent confirmation
cards, with distinct React keys.

## Tool coordination and privacy

The application owns a bounded routing graph: at most four explicit command parts,
one draft of each personal-action type and the existing calendar draft limit.
Tasks/reminders/memory use deterministic English parsing; calendar structured
interpretation continues through the selected local Ollama model. There is no
new general-purpose model planner or SQL generation. Unsupported mutation wording
asks for clarification; descriptions of hypothetical actions are not executed.

Document excerpts may propose a task deadline only when one distinct ISO date is
found. Its application-assigned document source is shown, with a warning to verify
it. A date in an excerpt is not proof that it is the intended project deadline.
The calendar and task confirmations remain independent. Project references in
combined memory/task requests resolve existing projects or ask for clarification.

Retrieved text and model output cannot create new execution steps. Memory remains
lower-trust context, bounded by existing local relevance retrieval (up to three
entries and 1,000 characters), with disable/revision checks before generation.
Existing local embeddings are reused; none of this requires an external service.
Personal assistant requests cannot trigger web search. Previous personal requests
are also removed from contextual search-query construction. No memory retrieval
content is passed into search queries.

Credential-pattern checks reject recognizable passwords, tokens, keys and private
key material in memory content/categories. This is heuristic, not a universal
secret detector; do not deliberately store credentials. SQLite is local, not newly
encrypted. Existing OS account/file protections remain necessary. Deleting a
memory does not erase copies already present in historical chat text.

## Reminder guarantees and limitations

The open application polls every 15 seconds. The server materializes a bounded
window (24 hours behind, seven days ahead) and atomically claims at most five
reminders per poll. Stable occurrence IDs prevent repeated claims after restart
or concurrent polling. Older outstanding entries become missed. At most 100
reminder schedules are accepted. Target changes update pending occurrences;
completed tasks and cancelled event occurrences do not produce pending alerts.

“Available in app” means a durable claimed history entry, not proof that a person
saw it. Desktop status is tracked separately. Browser permission is requested only
from the explicit enable button, never repeatedly by the polling loop. Denied or
unsupported notifications retain in-app history. A crash after claiming but before
desktop display may leave only the in-app record; this is not exactly-once desktop
delivery. Closed/suspended tabs, stopped server, sleeping/shut-down computers and
OS notification settings can delay/prevent alerts. No launch agent was installed.

## Validation

Final automated run: **434 passing, zero failing, 55 test files**. TypeScript and
ESLint with `--max-warnings 0` pass. Production build and `git diff --check` pass.
Tests cover repository CRUD, filters, projects, ambiguous matches, stale edits,
confirmation receipts, recurrence/DST/short months, exception persistence,
reminder catch-up/claims/settings/linked targets, permission fallback, memory
editing/duplicates/secrets/injection/retrieval, mixed tool routing and private
search-context exclusion. Existing chat, files, vision, search, generation-control,
stream/cancellation and persistence regression suites remain passing.

Chrome on macOS, using a disposable production-build database, verified:

- Task creation through the Tasks screen and a confirmed chat due-date preview.
- A confirmed memory preview and persistence of its receipt.
- A one-minute reminder, real polling, one in-app delivery and acknowledgement.
- A real selected-Ollama calendar interpretation with Monday 9 AM recurrence.
- Count-limited recurrence, one occurrence title edit and another cancellation.
- Refreshed UI retains the edited occurrence and later unaffected occurrence.

A live ordinary Qwen chat through the production API returned seven stream events,
completed without errors, and persisted its exact reply. Initial smoke-test calls
used a non-catalog model identifier and were correctly rejected; the UI catalog ID
passed without an application change.

A full process stop/restart compared exact API snapshots for tasks, calendar,
reminders/history, memories and the conversation, with all five matching.
Native date-field automation did not reliably commit input in Chrome; date editing
is covered by component/server tests and chat-generated dates, not claimed as a
completed manual date-picker acceptance test.

### Remaining verification limits

- Native desktop notification appearance was not tested by granting new OS/browser
  permissions. Granted/denied/unsupported behavior uses automated mocks; actual
  in-app timed delivery was tested live.
- No Windows runner or packaged Windows installer was tested. The code uses shared
  browser/Node APIs, but that is not a claim of verified Windows delivery.
- Existing Gemma vision, model switching, inference controls, live Brave and file
  import workflows were regression-tested, not all repeated manually this milestone.
  No Brave request or model download was needed for this work.
- Combined document → task/calendar routing is tested with synthetic excerpts and
  mocked interpretation; not every combined workflow was repeated against live
  attachments and Ollama in Chrome.
- English command support is deliberately limited. No new model-based fallback
  was added for arbitrary task/reminder/memory wording. Use the page or edit the
  preview when wording or dates are unclear.

## Git state

Work is uncommitted on `main`, based on
`1caca46e3f4c768c36594d26712db14bc227229e`. Nothing was staged, committed or pushed.
No dependency/lockfile changes, personal databases, uploads, credentials or build
output are intended project changes. Synthetic acceptance artifacts stay outside
the repository. This report and README describe the current behavior; historical
milestone reports remain unchanged.

## Changed and created files

- `README.md`
- `docs/milestone-9.md`
- `src/components/app-shell.tsx`
- `src/components/calendar-page.tsx`
- `src/components/chat-calendar-action.tsx`
- `src/components/chat-memory-action.tsx`
- `src/components/chat-task-action.tsx`
- `src/components/memory-settings.tsx`
- `src/components/notification-indicator.tsx`
- `src/components/recurrence-fields.tsx`
- `src/components/reminders-page.tsx`
- `src/components/tasks-page.tsx`
- `src/hooks/use-memories.ts`
- `src/lib/assistant-actions.server.test.ts`
- `src/lib/assistant-actions.server.ts`
- `src/lib/calendar-action.server.test.ts`
- `src/lib/calendar-action.server.ts`
- `src/lib/calendar-action.ts`
- `src/lib/calendar-config.ts`
- `src/lib/calendar-date.ts`
- `src/lib/calendar-time.ts`
- `src/lib/calendar.server.test.ts`
- `src/lib/calendar.server.ts`
- `src/lib/calendar.ts`
- `src/lib/conversation-chat.server.test.ts`
- `src/lib/conversation-chat.server.ts`
- `src/lib/conversations.server.ts`
- `src/lib/conversations.ts`
- `src/lib/memories.server.test.ts`
- `src/lib/memories.server.ts`
- `src/lib/memories.ts`
- `src/lib/memory-actions.server.test.ts`
- `src/lib/memory-actions.server.ts`
- `src/lib/memory-api.server.ts`
- `src/lib/memory-config.ts`
- `src/lib/recurrence.test.ts`
- `src/lib/recurrence.ts`
- `src/lib/reminder-config.ts`
- `src/lib/reminders.server.test.ts`
- `src/lib/reminders.server.ts`
- `src/lib/reminders.ts`
- `src/lib/task-actions.server.ts`
- `src/lib/task-config.ts`
- `src/lib/tasks.server.test.ts`
- `src/lib/tasks.server.ts`
- `src/lib/tasks.ts`
- `src/lib/tool-plan.ts`
- `src/lib/types.ts`
- `src/routeTree.gen.ts`
- `src/routes/api.memories.$id.ts`
- `src/routes/api.memories.ts`
- `src/routes/api.reminders.ts`
- `src/routes/api.tasks.ts`
- `src/routes/chat.tsx`
- `src/routes/reminders.tsx`
- `src/routes/tasks.tsx`
- `src/test/calendar-page.test.tsx`
- `src/test/chat.test.tsx`
- `src/test/memory-settings.test.tsx`
- `src/test/notification-indicator.test.tsx`
- `src/test/tasks-page.test.tsx`

## Follow-up fix: global reminder notifications

### Confirmed root cause

Polling was not literally confined to `RemindersPage`: it lived inside
`NotificationIndicator` in each route's `AppShell`. Each page replaces that shell,
so navigation unmounted the polling effect. Its cleanup stopped client processing,
but did not cancel a request already claiming SQLite deliveries. A claim could
therefore commit before its response was discarded. The shared indicator only
showed a count; titles and acknowledgement controls existed only on Reminders.
Reminders also had a separate history-refresh interval.

### Correction and lifecycle

A single `ReminderProvider` is mounted in the persistent root, above `Outlet`.
The sidebar indicator only consumes its context. One non-overlapping 15-second
loop coordinates claiming and inbox reads; there are no page polling loops.
Requests have a ten-second timeout and unmount cancellation. Visibility/online
wake-ups reuse the same overlap guard. Errors retain existing alerts and retry
on the next poll or wake-up. Acknowledgement revisions prevent an older poll from
restoring an alert during an acknowledgement race.

The fixed panel is outside routed content. It shows title, due time, Acknowledge
and Dismiss; changing pages does not remove it. The Reminders query cache is
updated by the controller, keeping history current without a second interval.

SQLite lifecycle remains compatible with existing records:

1. `scheduled`: a due occurrence exists.
2. Atomic claim changes it to `delivered`: **durably available in the in-app inbox**,
   not proof a browser displayed it. A separate pending query recovers these rows
   even if the claim response is lost. It is independent of the most recent 200
   history rows, returns up to 200 oldest unread alerts, and exposes later batches
   as earlier alerts are acknowledged. No destructive migration is needed.
3. React renders that inbox on every route. There is no new claim of guaranteed
   human visibility, and unread records remain until acknowledged/dismissed.
4. For granted desktop permission, an atomic `not-requested` → `attempted`
   reservation prevents multiple browser instances or retries repeating a native
   attempt. `onshow`/`onerror` record `shown`/`failed` separately. A crash between
   reservation and display can lose the native attempt; the in-app inbox survives.
5. `acknowledged`/`dismissed` removes an item from the unread query, not history.

No new permission prompt, runtime dependency, OS service or personal-data access.
Desktop delivery is still not guaranteed while Chrome/server is stopped or the
computer is sleeping. Permission-denied/unsupported browsers keep in-app alerts.

### Focused files

- New: `src/components/reminder-provider.tsx`, `src/lib/reminder-context.ts`.
- Changed: `src/routes/__root.tsx`, `src/components/notification-indicator.tsx`,
  `src/components/reminders-page.tsx`, `src/lib/reminders.ts`,
  `src/lib/reminders.server.ts`, `src/lib/reminder-config.ts`.
- Tests: `src/test/notification-indicator.test.tsx`,
  `src/lib/reminders.server.test.ts`; this report.

The earlier uncommitted milestone work is preserved. Nothing is committed or pushed.

### Follow-up validation results

Final suite: **440 passing, zero failing, 55 test files**. TypeScript, ESLint
with zero warnings, production build and Git whitespace checks pass.
The focused tests cover route child replacement with a single controller,
unmount abortion, overlapping poll prevention, lost-response recovery, multiple
pending alerts, acknowledged-item suppression, permission default/denied/unsupported,
granted desktop reservation, visible/hidden wake-up behavior, and restart-safe
pending/desktop/acknowledgement state. Desktop permission cases and hidden-tab
visibility changes use mocks; no real native macOS notification was observed.

Chrome acceptance used a new disposable database and the production build:

| Current page at deadline | Real in-app result                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat                     | PASS: reminder created through the Reminders form, switched to Chat before due; title/time/actions appeared without returning. A real Qwen conversation also completed. |
| Calendar                 | PASS: new timed alert appeared; stayed visible after navigating to Tasks.                                                                                               |
| Tasks                    | PASS: separate new timed alert arrived and was acknowledged there.                                                                                                      |
| Files                    | PASS: separate new timed alert arrived and was acknowledged there.                                                                                                      |
| Settings                 | PASS: two simultaneous alerts appeared after rapid Calendar/Tasks/Settings navigation, one card per delivery.                                                           |

Except for the first UI-created reminder, timed fixtures were scheduled through the
local reminder API with synthetic content. The browser performed the route changes,
observed timed delivery and used acknowledgement/dismissal controls. No personal
production database was used. A temporary stale-asset navigation failure occurred
because the test server was still running during a build; restarting the final
build resolved it, and navigation passed afterward.

Stopping the isolated server while two alerts were visible produced the retry
message without removing either alert. Restarting recovered automatically without
refresh, then refreshing also restored exactly those two unread alerts. SQLite
contained six unique delivery IDs, four acknowledged and two pending at that
checkpoint. Acknowledge/dismiss on Settings then cleared the inbox; Reminders
history showed five acknowledged and one dismissed. Previously acknowledged
alerts did not reappear during subsequent polls/navigation/restart.

Remaining limitations: real native desktop display, real browser suspension and
Windows execution are unverified. Hidden/visible and browser permission cases are
covered by automated mocks. A browser may throttle timers; visibility/online
wake-ups reduce delay but cannot guarantee exact delivery times. The durable
in-app inbox remains authoritative even when a desktop attempt fails or crashes.
