# Phase 4A whole-branch review — fixes

Branch `phase-4a-member-completion-and-chat`, from `d469d26`. Nine findings,
five commits.

| # | Fix | Commit |
|---|-----|--------|
| 1 | `messages_update_read` had no `with check` | `250b018` |
| 2 | unread badge and inbox never live | `8b0dd03` |
| 3 | composer rendered with `threadId === null` | `94dffbf` |
| 4 | two comments claimed a non-existent optimistic insert | `94dffbf` |
| 5 | `fetchMemberThread` broke after switching professional | `94dffbf` |
| 6 | `chooseProfessional` offline was a silent dead end | `0c3bed9` |
| 7 | `slotToISO` existed twice | `db3622d` |
| 8 | `localDayISO` reimplemented inline three times | `db3622d` |
| 9 | picker's "No match" conflated two nothings; `ensureThread` had no scope | `0c3bed9`, `94dffbf` |

---

## FIX 1 (Critical) — `messages_update_read` lets either party rewrite the other's messages

New file only: `supabase/patches/008-messages-update-read.sql`. `policies.sql`
is untouched, per this project's patches-on-top convention.

- `supabase/patches/008-messages-update-read.sql:1-58` — the comment header:
  what the missing `with check` allowed (a `body` forgery indistinguishable from
  the original, since `sender_id` never changes; and `read_at` set back to
  `null`, pinning the other person's unread badge), why the column grant rather
  than the policy is the load-bearing half, and the ordering requirement against
  patch 006.
- `:60-61` — `revoke update on public.messages from anon, authenticated;` then
  `grant update (read_at) on public.messages to authenticated;`. `anon` gets
  nothing back: it has no `auth.uid()` and could never satisfy the policy.
  `service_role` is left untouched — it bypasses RLS by design and never runs in
  a browser.
- `:63-78` — drop and recreate the policy. The `using` predicate is copied
  verbatim from `supabase/policies.sql:172-177`; the new `with check` repeats it
  and adds `and read_at is not null`.
- `:80-113` — PASS/FAIL block, in the house style of patches 001/006/007. Five
  rows: `read_at` updatable by `authenticated` (true), **`body` updatable by
  `authenticated` (false)** — the row that proves the hole is shut — `read_at`
  updatable by `anon` (false), `with_check is not null`, and `with_check`
  containing `read_at IS NOT NULL`.

Idempotent: revoking an unheld privilege, granting a held one and
`drop policy if exists` are all no-ops on a second run.

### Handoff for Davide

Run this in the Supabase SQL editor, on the project that already has patches
001–007 applied:

1. Paste the whole of `supabase/patches/008-messages-update-read.sql` and run it.
2. All five rows of its output must read **PASS**. `app role can update body`
   must be `false` — if it reads `true`, patch 006 was replayed after 008 and 008
   needs re-running (006 grants UPDATE on every column, which undoes the revoke).
3. Then re-run `supabase/verify.sql`. Its two grant rows are unaffected — see
   below.
4. Smoke test: open the chat as `daniel@trainhub.dev`, read a message from Coach
   Andrea, and confirm the unread badge clears. That exercises `markThreadRead`,
   the only UPDATE the app issues against this table — it writes `read_at` and
   nothing else, filtered to `sender_id <> me` and `read_at is null`, so it
   passes both the column grant and the new check.

### Does `verify.sql` still pass after the revoke?

**Yes.** Read at `supabase/verify.sql:42-51`: the two grant rows call
`has_table_privilege(..., 'select')` and `has_table_privilege(..., 'insert')`.
Neither asks about `update`, and patch 008 revokes only `update`. `messages`
keeps its SELECT and INSERT grants untouched, so both rows still count 16 and
read PASS.

The four seed-count rows still read FAIL by design once patch 005 has run, as
that file's own comment explains. Nothing in 008 changes that.

I deliberately did **not** assert `has_table_privilege(..., 'update')` in 008's
own check block: whether that function reports a column-only grant as `true` is
a semantic I did not want to rely on. `has_column_privilege` on `read_at` and on
`body` states the same thing unambiguously.

---

## FIX 2 (Important) — the unread badge and the inbox are never live

Two lines, each commented. No second Realtime channel.

- `src/layouts/AppLayout.jsx:31-38` — `refetchInterval: 60_000` on the
  `unreadCount` query, with the reason: the chat's channel is filtered to one
  `thread_id` so it cannot feed a badge that counts every thread, and this layout
  never unmounts on inner navigation, so without an interval the badge is frozen
  at its page-load value.
- `src/features/chat/ThreadListScreen.jsx:21-27` — same on the `threads` query:
  a professional sitting on the inbox would otherwise never see a message arrive.

Both comments name the alternative (an unfiltered shell-level subscription) and
why it is not worth a second channel at this scale.

---

## FIX 3 (Important) — the composer renders with `threadId === null`

- `src/features/chat/ThreadScreen.jsx:134-143` — the `!threadId` branch now
  renders an `EmptyState` ("Setting up your chat" / "This finishes as soon as
  you are back online.") and the spinner is gated on `threadId &&
  messages.isPending`. Offline this state is permanent, so an indefinite
  spinner was the wrong shape for it.
- `src/features/chat/ThreadScreen.jsx:158-181` — the composer's `<Box>` is
  wrapped in `{threadId ? … : null}`, with a comment recording the failure it
  prevents: a send with `threadId` still null queues `thread_id: null` and dies
  on the not-null constraint at reconnect.

Also touched here as a consequence of FIX 5 (see below): the "No trainer yet"
early return had to move **above** the `isPending` gate, because the lookup is
now disabled without a professional and so stays `pending` forever.
`src/features/chat/ThreadScreen.jsx:83-94`, with a comment saying why the order
matters.

---

## FIX 4 (Important) — two comments claimed an optimistic insert that did not exist

The comments are now true because the insert exists.

- `src/data/mutations.js:180-212` — `onMutate` added to the `sendMessage`
  registration. Follows `src/features/workout/LogSetSheet.jsx:34-52`: a single
  `setQueryData` on `queryKeys.threadMessages(threadId)`, appending
  `{id, thread_id, sender_id, body, read_at: null, created_at}` from the
  variables the caller already supplies.
- `src/data/mutations.js:10` — `queryKeys` added to the existing
  `queryPrefixes` import.
- `src/features/chat/MessageComposer.jsx:21-24` — comment now points at the
  registration by name instead of asserting a queue-and-render that did not
  happen.
- `src/features/chat/useThreadMessages.js:45-49` — comment now names
  `sendMessage`'s `onMutate` and the shared client-generated id that makes the
  dedupe hold.

Details checked as instructed:

- **`undefined` cache is not fabricated.** `if (!current) return current`, the
  same guard and reasoning as the Realtime handler at
  `src/features/chat/useThreadMessages.js:42-44`. The pending first fetch will
  include the row anyway.
- **The dedupe holds.** `useThreadMessages.js:50` keys on
  `message.id === payload.new.id`. The id in the optimistic row is the same
  `crypto.randomUUID()` the call site passes as the upsert's primary key
  (`ThreadScreen.jsx:171`, `src/data/chat.js:143`), so the server echoes that
  exact id back and the Realtime insert is a no-op.
- **No `onSettled` at the call site.** `ThreadScreen.jsx:43` is still bare
  `useMutation({ mutationKey: mutationKeys.sendMessage })`.
- **No rollback**, as directed. The comment records the trade: a paused send
  that fails permanently leaves the row until the next refetch drops it, which
  beats deleting a message the user believes they sent.
- Registered on the default rather than at the call site so a **replayed** send
  is covered by the same code. `created_at` uses the local clock and is
  commented as such — the real row's `created_at` is the column default, and the
  optimistic value only has to sort the row last.

---

## FIX 5 (Important) — `fetchMemberThread` breaks once a member switches professional

Grepped both names first; there was exactly one call site of each, both in
`ThreadScreen.jsx`.

- `src/data/chat.js:29-49` — `fetchMemberThread(memberId, proId)`, with
  `.eq('pro_id', proId)` added. The docblock now explains the pair-uniqueness
  and the `PGRST116` it caused.
- `src/lib/queryKeys.js:23-25` — `memberThread: (memberId, proId)`.
- `src/features/chat/ThreadScreen.jsx:26-38` — `const proId =
  profile?.assigned_pro_id ?? null`, passed to both the key and the function,
  and `enabled: isMember && Boolean(proId)`.
- `src/features/chat/ThreadScreen.jsx:73-81`, `:111` — the `ensureThread` call
  and its retry now use the same `proId` local.

The `enabled` change is why the "No trainer yet" return had to move up; see
FIX 3.

**Known future work, not fixed** (as directed): unread messages in an abandoned
thread still count toward the badge. `fetchUnreadCount`
(`src/data/chat.js:112-122`) counts across every thread RLS lets the member see,
and after a switch the old thread is still one of them. The member can no longer
open it, so the badge cannot be cleared from the UI. Options for later: filter
the count to the assigned pair, or mark the old thread read/archived when
`chooseProfessional` succeeds.

---

## FIX 6 (Minor) — `chooseProfessional` offline is a silent dead end

- `src/features/trainer/BrowseTrainersScreen.jsx:36` — `const savedOffline =
  choose.isPending && choose.isPaused`, the same expression as
  `BookingSheet.jsx:44` and `ThreadScreen.jsx:161`.
- `src/features/trainer/BrowseTrainersScreen.jsx:98-105` — an
  `<Alert severity="info">` above the error alert, wording matched to its two
  siblings: "You are offline. This choice is saved on your device and will be
  sent when you reconnect."

The buttons stay disabled while pending — that is correct here, unlike the
composer, because choosing twice would queue two conflicting profile writes.
The Alert is what was missing.

---

## FIX 7 (Minor) — `slotToISO` existed twice, byte-identical

- `src/lib/format.js:50-66` — `slotToISO` moved in beside `localDayISO`, with a
  docblock naming both callers and both date traps (`new Date('…T14:00')` is
  implementation-dependent, `new Date('2026-07-29')` is UTC midnight).
- `src/features/trainer/BookingSheet.jsx:5`, and the local copy deleted.
- `src/features/calendar/NewAppointmentSheet.jsx:9`, and the local copy deleted.
- `src/lib/format.selfcheck.js:3`, `:56-77` — six new assertions: the
  local-hour round trip for start and end; the local calendar day of a `00:30`
  start and a `23:30` start (the assertion that fails if anyone reaches for
  `new Date(dayISO)`); a 60-minute slot from `23:30` landing on the next day;
  single-digit month and day, which catches a month-index-off-by-one; and the
  duration measured in milliseconds. Expectations are computed through the local
  `Date` constructor, matching the file's existing convention, so they hold in
  any zone.

---

## FIX 8 (Minor) — `localDayISO` reimplemented inline

Confirmed equivalent before changing anything: `toLocaleDateString('sv-SE')`
formats the **local** day as zero-padded `YYYY-MM-DD`, and `localDayISO`
(`src/lib/format.js:38-43`) builds the same string from `getFullYear` /
`getMonth` / `getDate` with `padStart(2, '0')`. Same frame, same shape — no
behaviour change.

- `src/features/trainer/MemberAppointmentsScreen.jsx:9`, `:34-37` — `dayOf` is
  now `localDayISO(appointment.starts_at)`; the comment keeps the warning about
  `toISOString().slice(0, 10)` and adds that only the shared helper is
  self-checked.
- `src/features/calendar/CalendarScreen.jsx:13`, `:49`, `:54` — both sites.

---

## FIX 9 (Minor) — "No match" conflated two nothings, and `ensureThread` had no scope

- `src/features/trainer/BrowseTrainersScreen.jsx:112-126` — two-branch check
  copied from `ThreadListScreen.jsx:75-92`: `professionals.data?.length === 0`
  gives "No professionals yet" / "Certified coaches will appear here once they
  join."; `length > 0 && visible.length === 0` keeps "No match".
- `src/data/mutations.js:213-216` — `scope: { id: 'chat' }` on the
  `ensureThread` registration, matching `sendMessage` and `markThreadRead`. Now
  a queued send cannot replay ahead of the thread it needs.

---

## Verification

`npm run lint` — exit 0:

```
> trainhub@0.0.0 lint
> eslint .

LINT EXIT: 0
```

`npm run build` — succeeded (tail):

```
dist/assets/index-DK4Qpatn.js                              313.35 kB │ gzip: 97.12 kB

✓ built in 522ms

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
✓ 88 modules transformed.
dist/sw.mjs  23.31 kB │ gzip: 7.69 kB
✓ built in 54ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  83 entries (1139.02 KiB)
files generated
  dist/sw.js
```

All eight self-checks:

```
$ node src/lib/format.selfcheck.js
format: OK
$ node src/theme/resolveTokens.selfcheck.js
resolveTokens: OK (22 tokens)
$ node src/features/workout/timer.selfcheck.js
timer: OK
$ node src/features/workout/status.selfcheck.js
workout status: OK
$ node src/features/workout/summary.selfcheck.js
summary: OK
$ node src/features/clients/subscription.selfcheck.js
subscription.selfcheck OK
$ node src/features/calendar/month.selfcheck.js
month.selfcheck OK
$ node src/features/progress/progress.selfcheck.js
progress.selfcheck OK
```

No `eslint-disable` was added anywhere. Reads still carry
`.retry(navigator.onLine)` — `fetchMemberThread` kept its call through the
signature change; writes still do not. No call site passes `onSettled`.

## Found while fixing, not in the findings

1. **FIX 5 had a second-order consequence the finding did not name.** Making the
   lookup `enabled: isMember && Boolean(proId)` means a member with no
   professional leaves the query permanently `pending`, and the existing
   `if (isMember && memberThread.isPending) return <LoadingState />` sat *above*
   the "No trainer yet" return — so the narrow fix would have replaced a
   working empty state with an eternal spinner for every unassigned member. The
   two returns are now ordered deliberately, with a comment. Anyone re-ordering
   them reintroduces the spinner.

2. **The `scope: { id: 'chat' }` added in FIX 9 matters more than as symmetry.**
   All three chat writes now share one scope, so `resumePausedMutations` replays
   them serially in queue order. That is what makes the FIX 3 gate sufficient
   rather than merely likely: the thread is created before the sends that depend
   on it, instead of racing them.

3. **`sendMessage` returns `null` on a replay and that is now visible.**
   `ignoreDuplicates: true` means a replayed upsert returns no row
   (`src/data/chat.js:148-149`). With FIX 4's `onMutate` the row is on screen
   from the client's own insert, so the `null` return is harmless — but any
   future `onSuccess` that reads the returned row must handle `null`. Worth
   knowing before someone adds one.

4. **Patch 008 introduces an ordering dependency between patches.** It is the
   first patch that *narrows* something patch 006 grants broadly, so replaying
   006 silently reopens the hole. Recorded in 008's header and in the handoff
   above; if a `patches/README` is ever written, this belongs in it.

---

## Three small corrections, post-branch-review (commit `7eb3d5f`)

A second pass over the fixes above found three more inaccuracies: two false
comments and one inverted example. All prose-only except a one-line guard
added where the false comment turned out to be masking a real gap.

### 1 — `sendMessage`'s registration comment claimed the wrong mechanism

- `src/data/mutations.js:174-182` (comment above `onMutate`). The old text said
  the mutation was "Registered here rather than at the call site so a replayed
  send is covered too", and implied a paused mutation surviving a reload is
  what `onMutate` addresses. Neither holds.

  Verified against `node_modules/@tanstack/query-core/build/modern/mutation.js:88-105`:
  `execute` computes `const restored = this.state.status === 'pending'` and
  only calls `onMutate` in the `else` branch. A **rehydrated** pending
  mutation (the reload case) takes the `restored` branch, calls
  `onContinue()`, and never re-enters `execute` — so `onMutate` does not run a
  second time for it. The optimistic row instead survives a reload because the
  **query cache** is what's persisted (`src/lib/queryClient.js`, default
  `shouldDehydrateQuery` keeps successful queries), not because this hook
  fires again.

  The comment now says why the mutation is still registered here (consistency
  with every other write in the file, so the persister can find `mutationFn`
  by key after a reload) and states the real reason the row survives a reload,
  with a pointer at the exact branch in `mutation.js` that proves it.

### 2 — `onMutate` was missing the `cancelQueries` its own precedent has

- `src/data/mutations.js:186-192` (`onMutate`, now `async`). Compared against
  `src/features/workout/LogSetSheet.jsx:34-38`, which opens its `onMutate` with
  `await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })`
  before touching the cache. `sendMessage`'s `onMutate` had the `setQueryData`
  but not the guard in front of it.

  This is a real (if narrow) gap: `src/features/chat/useThreadMessages.js`
  invalidates the whole `['chat']` prefix on every incoming Realtime message,
  so a `threadMessages` refetch is frequently in flight; a send landing inside
  that window had its optimistic row overwritten when the stale-triggered
  fetch resolved after the optimistic write. Self-heals online (next
  invalidate/refetch repaints the row from the server) and cannot happen
  offline (no refetch to race), so it was never a correctness bug — just a
  flicker — but the fix is the one line the precedent already establishes:

  ```js
  await queryClient.cancelQueries({ queryKey: queryKeys.threadMessages(threadId) })
  ```

  added at the top of `onMutate`, with a short comment naming the race.

### 3 — Inverted example in `format.selfcheck.js`

- `src/lib/format.selfcheck.js:64-70` (comment above the two `slotToISO` /
  `localDayISO` assertions at what are now lines 71-72). The old text claimed
  "UTC midnight plus 14 hours is still the 29th in Rome, but plus 00:30 is the
  28th" — backwards: in Rome, `new Date('2026-07-29')` (UTC midnight) is
  already 02:00 local on the 29th, so 02:00 + 00:30 stays the 29th, not the
  28th.

  Traced what the two assertions actually pin by comparing the correct
  local-frame instant against the buggy UTC-frame one (treating the clock
  string as UTC rather than local) for both fixtures:
  - `00:30`, west-of-Greenwich (e.g. UTC-5): correct instant is
    `2026-07-29T05:30Z`; buggy is `2026-07-29T00:30Z`, which reads back as
    `2026-07-28T19:30` local — a day *behind*. This fixture catches the bug
    only in negative-offset zones.
  - `23:30`, east-of-Greenwich (e.g. UTC+2): correct instant is
    `2026-07-29T21:30Z`; buggy is `2026-07-29T23:30Z`, which reads back as
    `2026-07-30T01:30` local — a day *ahead*. This fixture catches the bug
    only in positive-offset zones.

  Rewrote the comment to describe that mechanism instead — the same
  either-direction coverage the file already documents for the `localDayISO`
  fixtures a few lines above (lines 37-46), which this one mirrors.

### Verification

```
$ npm run lint
> trainhub@0.0.0 lint
> eslint .
(exit 0, no output)

$ npm run build
✓ 1177 modules transformed, built in 535ms
PWA v1.3.0 — sw.js built, injectManifest, 83 entries precached
(exit 0)

$ node src/lib/format.selfcheck.js
format: OK

$ node src/features/workout/timer.selfcheck.js
timer: OK

$ node src/features/workout/summary.selfcheck.js
summary: OK
```

Commit: `7eb3d5f` — `fix(chat): correct false comments and cancel in-flight
refetch on send`. Two files changed (`src/data/mutations.js`,
`src/lib/format.selfcheck.js`), nothing under `.superpowers/sdd/` staged.
