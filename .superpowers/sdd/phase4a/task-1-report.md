# Task 1 report: Chat data layer and Realtime

## What was implemented

Transcribed the brief verbatim into six files:

1. `supabase/patches/007-realtime-messages.sql` — idempotent patch that adds
   `messages` to the `supabase_realtime` publication, sets
   `replica identity full`, and prints the publication's contents so a missing
   entry is loud rather than silently working.
2. `src/lib/queryKeys.js` — added `memberThread`, `threads`, `threadMessages`,
   `unreadCount`, `professionals`, `memberAppointments` to `queryKeys`, and
   `chat`, `professionals` to `queryPrefixes`. (`memberAppointments` and
   `professionals` are for later Phase 4A tasks per the brief; added now so no
   later task edits this file again.)
3. `src/lib/mutationKeys.js` — added `sendMessage`, `markThreadRead`,
   `chooseProfessional` (the last is for a later task, same reasoning).
4. `src/data/chat.js` — `ensureThread`, `fetchMemberThread`, `fetchThreads`,
   `fetchMessages`, `fetchUnreadCount`, `sendMessage`, `markThreadRead`. Every
   read carries `.retry(navigator.onLine)`; both writes (`sendMessage`,
   `markThreadRead`) do not.
5. `src/data/mutations.js` — imported `markThreadRead, sendMessage` from
   `./chat.js` and registered both via `queryClient.setMutationDefaults`,
   sharing `scope: { id: 'chat' }` on the registered default (not on any call
   site — no call sites exist yet in this task), each invalidating
   `queryPrefixes.chat` in `onSettled`.
6. `src/features/chat/useThreadMessages.js` (new directory) — the Realtime
   hook. Query is source of truth; the `postgres_changes` INSERT subscription
   only calls `queryClient.setQueryData` to append, guarded by
   `if (!current) return current` and a duplicate-id check, then invalidates
   `queryPrefixes.chat`.

## Columns checked against `supabase/schema.sql`

- `threads`: `id`, `member_id`, `pro_id`, `created_at`, `unique (member_id, pro_id)` — lines 146-152. All columns used by `ensureThread`/`fetchMemberThread`/`fetchThreads` exist; `unique (member_id, pro_id)` backs the `onConflict: 'member_id,pro_id'` upsert.
- `messages`: `id` (no default — confirmed, just `primary key`), `thread_id`, `sender_id`, `body`, `read_at`, `created_at` — lines 154-161. All columns in `MESSAGE_COLUMNS` and every read/write in `chat.js` exist.
- FK naming: `threads.pro_id references profiles(id)` and `threads.member_id references profiles(id)` are plain inline `references` clauses, so Postgres's default constraint-naming convention (`<table>_<column>_fkey`) applies, giving `threads_pro_id_fkey` and `threads_member_id_fkey` — matching the embeds in `fetchMemberThread` and `fetchThreads`.

## Commands run and output

- `npm run lint` — exit 0, no output (clean).
- `npm run build` — succeeded: `vite build` completed, PWA service worker built via `injectManifest`, `dist/sw.js` generated. No errors or warnings besides an unrelated pre-existing `inlineDynamicImports` deprecation notice from the PWA plugin.

## Files changed

- `supabase/patches/007-realtime-messages.sql` (new)
- `src/data/chat.js` (new)
- `src/features/chat/useThreadMessages.js` (new)
- `src/lib/queryKeys.js` (modified)
- `src/lib/mutationKeys.js` (modified)
- `src/data/mutations.js` (modified)

Confirmed via `git show --stat HEAD` that the commit contains exactly these
six files, 304 insertions, 0 deletions.

## Self-review findings

- Both `sendMessage` and `markThreadRead` are registered with
  `scope: { id: 'chat' }` on the `setMutationDefaults` call (the registered
  default), not at any call site — no call sites were added in this task, so
  there was nothing to get wrong here, but the registration itself matches the
  brief exactly.
- No call site passes `onSettled` — none exist yet in this task.
- The Realtime hook carries both guards (`if (!current) return current` and
  the duplicate-id check) and invalidates through `queryPrefixes.chat`, not a
  sliced key.
- Nothing was added beyond what the brief specified — `professionals` and
  `memberAppointments` in `queryKeys`/`queryPrefixes`, and `chooseProfessional`
  in `mutationKeys`, are explicitly called for by the brief's Step 2 ("Add the
  keys") even though this task's own interface list doesn't consume them; the
  brief and the task instructions both say to add all of them now so no later
  task edits these two files again.
- `.superpowers/sdd/progress.md` was modified in the working tree (controller
  bookkeeping) but deliberately left unstaged and out of the commit, per
  instructions to stage only the six named files.

## Deferred to the human

Run `supabase/patches/007-realtime-messages.sql` in the Supabase SQL editor.
The final `select` must list `messages`. If it does not, chat will connect and
stay silent — Realtime reports SUBSCRIBED for a table that is not on the
publication. No agent has database credentials, so this step could not be
performed here.
