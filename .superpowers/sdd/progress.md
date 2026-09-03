# TrainHub Phase 0 — progress ledger

Plan: `docs/superpowers/plans/2026-07-27-trainhub-phase-0-foundations.md`

**No commits are made by Claude.** The repo has zero commits until Davide makes
the baseline one. Reviews before that baseline are file-reading reviews; from
the baseline onward they are real working-tree diffs.

## Status

- **Task 1: complete** (no commits — review clean after one fix)
  - Theme pipeline live: `src/theme/{resolveTokens,tokens,index}.js`, self-check passes at 22 tokens.
  - Review found one Important issue: leftover `src/assets/vite.svg`. Fixed by controller (single `rm`, no references — grep confirmed). Lint clean after.
  - Plan corrected: Step 11 named `public/vite.svg`, which does not exist here. Both stock logos are under `src/assets/`.
  - Deferred to human: brief Step 12 (browser verification of background, font, card radius, pill button, responsive `h1`).
- **Task 2: complete** (no commits — review clean after two controller fixes)
  - Icon set generated via `@vite-pwa/assets-generator`; `dist/manifest.webmanifest` carries four icons, one maskable. Reviewer verified PNG dimensions from IHDR and the maskable safe zone by pixel distance (141.6px from centre vs 204.8px radius — clear).
  - Controller fix 1: the plan's `logo.svg` geometry let the white dumbbell swallow the H crossbar, so the mark read as two disconnected uprights. Crossbar raised to 56px, dumbbell slimmed. Reviewer confirmed the fix by decoding raw pixels of `pwa-64x64.png`.
  - Controller fix 2 (reviewer's Important): `public/favicon.svg` was still the stock Vite purple mark and is what `index.html` links. Replaced with a tab-sized TH variant (dumbbell dropped — mush at 16px). Also fixed `<title>trainhub</title>` → `TrainHub`, added `apple-touch-icon` link, `theme-color` meta, and `viewport-fit=cover`.
  - Plan corrected: the file list claimed the generator emits `public/favicon.svg`; `minimal2023Preset` emits `favicon.ico`.
- **Task 3: complete** (no commits — review clean after one controller fix)
  - `src/sw.js` hand-written, `strategies: 'injectManifest'` in place, ESLint scoped to the worker. Reviewer independently confirmed `self.__WB_MANIFEST` is really replaced, that `NavigationRoute` serves `index.html` for deep links like `/m/workout/session/abc`, and that no route touches Supabase REST (the offline data path is TanStack Query's IndexedDB cache, by design).
  - Controller fix (reviewer's Important + two Minors, one config block): `globPatterns` swept png/ico/svg that `includeAssets`/`manifest.icons` already precached, producing 6 duplicated entries, and pulled in `logo.svg` (generator source) and `icons.svg` (leftover). It also precached all seven Inter unicode-range subsets, forcing ~90 KiB of Cyrillic/Greek/Vietnamese the app will never render. Narrowed to `['**/*.{js,css,html}', 'assets/inter-latin*.woff2']`; added `favicon.svg` to `includeAssets` so it stays precached.
  - Also removed `maximumFileSizeToCacheInBytes: 4 MiB` — dead config. The reviewer showed the largest precached file is 327 KiB against Workbox's 2 MiB default, so the plan's justification comment was simply false.
  - Result: **27 entries / 552 KiB → 14 entries / 458 KiB, zero duplicates.**
  - Deferred to human: brief Step 6 (service worker activated in DevTools, offline hard-reload).
- **Tasks 4–6: SQL written, execution pending Davide.** Deliberately not dispatched
  to subagents: the plan already contains all three files verbatim, and DDL cannot
  run through the publishable key, so a subagent could only transcribe. Files were
  extracted straight from the plan (`awk`), so there is no transcription drift.
  - `supabase/schema.sql`, `supabase/policies.sql`, `supabase/seed.sql`, plus
    `supabase/verify.sql` holding the check queries that had been inline in the plan.
  - Controller fix: `exercises` had no unique constraint, so the seed's
    `on conflict do nothing` matched nothing and a second run would have duplicated
    all 10 exercises and every `session_exercises` row derived from them. Added
    `unique` on `exercises.name` and switched to `on conflict (name) do nothing`.
  - Controller fix: the seed header claimed idempotency it does not have. Replaced
    with the truth plus the truncate snippet needed to re-seed.
  - `verify.sql` adds a check the plan lacked: RLS enabled but with zero policies
    denies everything, which passes a `rowsecurity = true` check while silently
    breaking the app. Now counts policies per table too.
- **`.env.local` corrected:** `VITE_SUPABASE_URL` held the REST endpoint
  (`.../rest/v1/`) rather than the project URL, which would have produced
  `/rest/v1//rest/v1/...` on every call. Key is a new-style `sb_publishable_…`,
  not a legacy anon JWT — correct choice, needs a recent `@supabase/supabase-js`
  (Task 7 installs it).
- **ngrok domain:** `wrinkly-mankind-doodle.ngrok-free.dev` (note `.dev`, not `.app`).
  Substituted throughout the plan and spec.
- **Tasks 4–6: executed and verified.** Davide ran `schema.sql`, `policies.sql`,
  `seed.sql`; all 19 checks in `verify.sql` pass.
  - Ordering bug in the controller's handoff instructions: Davide was told to
    create the auth users *before* `schema.sql`, but `on_auth_user_created` is
    created *by* `schema.sql`, so it never fired and `profiles` stayed empty.
    The seed's `update profiles ... where id = ...` then no-opped silently at
    zero rows and the failure surfaced much later as a foreign key violation on
    `workout_plans`. Seed now upserts instead of updating, so either order works.
  - Users were later deleted and recreated with **Auto Confirm User** ticked, and
    the seed re-run against the clean slate (all FKs cascade from `auth.users`,
    so only `exercises` survived — and its new `unique(name)` kept the re-run clean).
- **Task 7: implemented, verification in progress.**
  - **CRITICAL security bug found and fixed** — `profiles_select_professionals`
    was `using (role = 'professional')`, a predicate that never references the
    caller, so PostgreSQL evaluated it true for unauthenticated requests. Anyone
    holding the publishable key — which ships in the JS bundle and is public by
    design — could read every professional's profile. The subagent caught it by
    probing RLS from an anonymous client (1 row returned where 0 was required).
    Fixed in `policies.sql` and applied to the live database via
    `supabase/patches/001-fix-profiles-anon-leak.sql`.
  - Audited the rest of `policies.sql` for the same shape: `exercises_select_all`
    and `availability_select_all` carry the `auth.uid() is not null` guard, and
    every other policy compares against `auth.uid()`, which is null-safe
    (`null = x` yields `null`, therefore false). Only the one hole existed.
  - Lesson for later phases: a policy whose `using` clause never mentions
    `auth.uid()` is public. `verify.sql` cannot catch this — the dashboard role
    bypasses RLS — so RLS must be probed from an anonymous client.
  - Pending review: two lint-driven deviations by the implementer (auth context
    split into its own file, one `eslint-disable`).
- **Task 7: complete** (no commits — review clean on the second re-review)
  - Review raised two Important defects, both inherited from the plan's code:
    (1) the profile fetch destructured only `data`, no `.catch()` — a denied row was
    swallowed and an offline fetch became an unhandled rejection, leaving `profile`
    null forever with `loading` false; (2) `loading` settled false before the profile
    resolved, so the role guard Task 9 builds on would have misrouted.
  - First fix (two stored readiness flags) was **rejected on re-review** and the
    reasoning was correct: the profile effect runs on mount before `getSession()`
    resolves, because a Promise `.then` is a microtask that cannot run until the
    synchronous effect flush finishes. So `profileReady` was set true for a user
    nobody had looked up, producing one committed render claiming the role was
    settled on every cold start with a persisted session, and on every direct
    account switch.
  - Second fix adopted the reviewer's stronger suggestion: **derive readiness
    instead of storing it.** `profileState = { forUserId, data, error }` written
    atomically, `matches = profileState.forUserId === userId` recomputed each render,
    `loading = !sessionReady || (Boolean(session) && !matches)`. A value recomputed
    every render cannot go stale. `profile` and `profileError` are gated on `matches`
    too, so the outgoing account's data cannot show for a render after a switch.
  - `profileError` now distinguishes causes: the `.catch()` path is tagged
    `{ offline: true, ... }`; a Postgrest error carries `.code`.
  - Open Minor (carried to final review): the profile fetch has no timeout or
    `AbortController`, so a network that stalls without resolving or rejecting would
    hang `loading` true. Pre-existing in the brief, not a regression.
- **Task 8: implemented, NOT yet reviewed.** `src/lib/queryClient.js` +
  `PersistQueryClientProvider` in `App.jsx` with `resumePausedMutations` on
  `onSuccess`. Verified by 7 assertions (config values + persister round-trip) using
  an in-memory stand-in for `idb-keyval`, since plain Node has no IndexedDB.
  - Implementer's own concern, still open: the real IndexedDB path was never
    exercised end to end. The browser check (DevTools → IndexedDB, then offline
    reload still serving cached data) is the one that actually proves it.
- **Task 8: complete** (review clean, two Minors both traced to the plan's example code)
  - One fixed: `maxAge` was hand-written a second time in `App.jsx` instead of reusing
    the constant. `queryClient.js` now exports `CACHE_MAX_AGE`.
  - One left as-is: `gcTime` equals `maxAge` rather than exceeding it. TanStack requires
    `gcTime >= maxAge`, so equal satisfies it, but there is zero margin.
  - Reviewer confirmed by reading package source: `onSuccess` fires only after
    `persistQueryClientRestore` resolves, so `resumePausedMutations()` runs against a
    hydrated cache; `idb-keyval`'s `get`/`set`/`del` match what the persister calls;
    `PersistQueryClientProvider` correctly wraps `AuthProvider`.
  - Unproven: the real IndexedDB path. The in-memory stand-in proves the persister's
    serialise/restore cycle, nothing about `idb-keyval`. Only the browser check does.
- **Task 9: complete** (review found one Critical, fixed and asserted)
  - **Critical, in the plan's own logic:** `BottomNav` picked the longest matching
    prefix, but Home's `to` is the section root (`/m`, `/p`), which prefixes every
    route in the section. When no other tab matched, Home won by default — so
    `/m/profile`, `/m/profile/badge`, `/m/profile/rewards`, `/m/profile/settings`,
    `/m/profile/subscription` and `/p/scan` all lit up Home. Exactly the failure the
    plan's comment claimed to prevent. Worse, the implementer's self-review table
    asserted the opposite of what the code did, without testing those routes.
    Fixed: the section root matches on exact equality only; every other tab owns a
    subtree. Asserted with 14 cases including all six previously-broken routes.
  - Controller additions to the failure branch: `role="alert"` (it swaps in without a
    navigation, so nothing announced the change), and a Sign out button for the
    denied/missing case — the copy told the user to sign out but gave them no way to,
    and every route lands back on that screen, so they were stuck short of clearing
    site data.
  - Another plan claim corrected: the comment insisting `calendar/availability` must
    precede `calendar/:appointmentId`. React Router ranks branches by segment
    specificity, not declaration order, so the literal already outranks the parameter
    either way.
  - Reviewer verified the role guard covers all four states with no redirect loop, and
    that a professional hitting `/` or `*` reaches `/p` in one extra hop.
- Task 10: not started — it is entirely human (build, ngrok, install on Android,
  Lighthouse, offline relaunch).

## Decisions

- `docs/*` stays gitignored but kept current — specs, plans and this ledger are
  working artifacts, not repository content. Confirmed by Davide.

## Minor findings carried to the final review

- `src/theme/resolveTokens.js` — `deref` returns `value.hex` unconditionally for
  non-string values. Every token in the file is a colour today, so this is
  correct now; a future non-colour token type (spacing, typography) would
  resolve to `undefined` silently instead of throwing. Guard it if the token
  set ever stops being colour-only.

- The `CacheFirst` image route in `src/sw.js` matches `request.destination === 'image'`
  with no origin scoping. Inert today (the only image is the precached hero), but
  once Phase 2/3 wire up Supabase Storage avatars, a member replacing their photo
  at the same path would keep seeing the stale one until the 30-day expiration.
  Route user-uploaded images separately (`StaleWhileRevalidate`, or scope the
  matcher by origin) when that lands.

## Notes for later tasks

- `public/icons.svg` is not stock Vite output and is unreferenced. Task 2 (PWA
  icons) should check whether it is the intended icon source before generating
  a new `public/logo.svg`.
- `.gitignore` originally ignored `doc/*`, which would have broken the build on
  a fresh clone since `src/theme/tokens.js` imports
  `doc/assets/variables.tokens.json`. Un-ignored stepwise; verified with
  `git ls-files --others --exclude-standard`.
- `docs/*` is still gitignored, so the spec and this plan are not tracked.
  Confirm with Davide whether that is intended.

# Phase 1 — Auth + Member Core
Plan: docs/superpowers/plans/2026-07-28-trainhub-phase-1-auth-member-core.md
Base commit: afa5886

Task 1: complete (commit 1fe67bb, review clean)
  Minor carried to final review: the `formatTimeRange` assertion in
  src/lib/format.selfcheck.js computes its expected value with the same
  `toLocaleTimeString('en-GB', opts)` call the implementation uses, so it only
  catches a broken separator, not a wrong locale/format choice. Plan-authored
  weakness, transcribed faithfully.
Task 2: complete (commit fa8a59d, review clean)
  Minor carried to final review: SESSION_STATUS.todo and the sessionStatusOf
  fallback are the same object reference, so a caller that mutated the returned
  object would corrupt the shared table. Inert today (values go straight into
  JSX). A "do not mutate" comment is enough if a consumer starts spreading them.
Task 3: complete (commit eb7b929, review clean, no findings)
  Deferred to human: the brief's Step 4 browser probe against the live database
  (verifies the PostgREST embeds resolve). Reviewer checked them statically
  against schema.sql instead -- FK hints, count flattening, UTC day range,
  maybeSingle vs single, embed ordering and column names all confirmed.
Task 4: complete (commit 88bd614, review clean)
  Minor carried to final review: the `typeof navigator !== 'undefined'` guard in
  ErrorState is redundant in a browser-only app with no test runner. Harmless.
Task 5: complete (commits f3555ef..1148677, re-review clean)
  CRITICAL found and fixed: LoginScreen redirected only on `user && profile`, but
  AuthProvider treats a FAILED profile fetch as settled (loading false, profile
  null forever) on RLS denial, missing row or offline. The Navigate never fired,
  the screen never unmounted, and the success path deliberately never re-enables
  the button -- so sign-in dead-ended on a permanently disabled "Logging in...".
  Fix: redirect on `user && !loading` and hand off to AppLayout, which already
  owns the profile-failure screen with Retry / Sign out. Plan's bug, not the
  implementer's.
  Minor carried to final review: a professional bounced from /m/... signs in and
  is sent back to `from`, then redirected again by the role guard. Two hops,
  terminates, no loop.
  Deferred to human: Step 4 browser verification table.
Task 6: complete (commits 3d47310..e495ad8, re-review clean)
  IMPORTANT found and fixed: the screen dead-ended after a send. The button was
  `disabled={submitting || sent}` and `sent` never reset, so a user who mistyped
  the address and corrected it could not resubmit -- the only escape was
  remounting the screen. Fix: clear `sent` and `error` on email change. Plan's
  bug, not the implementer's.
  Minor carried to final review: the error Alert renders `resetError.message`
  verbatim -- raw Supabase API text rather than product copy. No enumeration
  leak (Supabase answers uniformly for unknown addresses), but worth mapping to
  friendly messages later.
  Deferred to human: Step 3 (register the three redirect URLs in the Supabase
  dashboard) and Step 4 (browser verification). Step 3 BLOCKS the Task 7 flow --
  without it the reset email lands on the Site URL and never carries a code.
Task 7: complete (commits d166ac8..7a0a102, re-review clean)
  IMPORTANT found and fixed: StrictMode (enabled in src/main.jsx) double-invokes
  effects in React 19 dev, and a PKCE reset code is single-use. The first
  exchange consumed the code but its result was discarded (active=false); the
  second failed, so a VALID reset link rendered "Link not valid" under
  `npm run dev` while silently signing the user in. Fix: cache the exchange
  promise in a ref keyed by the code, so it runs once while every mount attaches
  its own handler. The obvious guard (early-return on replay) was rejected --
  it leaves the live mount with no handler and strands the screen on
  "Verifying your link...". Plan's bug, not the implementer's.
  Minor carried to final review: the 'done' phase has no render branch; it falls
  through to the form for at most one frame before navigate() unmounts. Dead
  state, harmless.
  Note: the implementer overwrote a stale Phase 0 task-7-report.md. Phase 0
  scratch reports in .superpowers/sdd/ collide with Phase 1 numbering. The
  ledger and git history are the durable record; no action needed.
  Deferred to human: Step 3 browser verification (needs a real reset email).
Task 8: complete (commits f739e5b..268a4f4, re-review clean)
  CRITICAL found and fixed (accessibility): AppointmentCard carried the done
  state only through which icon rendered, and MUI hides SvgIcon from screen
  readers unless `titleAccess` is passed -- so an appointment's status was
  invisible to anyone not looking at it. Fix: a statusLabel covering all four
  appointment_status values, passed as titleAccess. Verified against the
  installed @mui/material@9.2.0 that titleAccess drops aria-hidden, adds
  role="img" and renders a <title>. Plan's bug, not the implementer's.
  Also fixed (Minor, same lines): `cancelled` took the grey settled background
  but kept the unchecked icon, contradicting the code's own comment. Now only
  `done` earns the tick and the label distinguishes the four states.
  Caution recorded: the fix subagent's report table confused `kind` with
  `status`, claiming backgrounds `task.pending`/`task.confirmed` that do not
  exist in the theme. The CODE was correct; the report was not. Controller
  verified the file directly. Do not trust subagent report tables over source.
Task 9: complete (commits ed89052..95c5119, re-review clean)
  IMPORTANT found and fixed: with networkMode 'offlineFirst' a failed refetch
  leaves `data` populated from the persisted cache, but the screen rendered
  ErrorState ABOVE the still-usable list -- telling an offline user the app is
  broken when it is doing exactly what it was built to do. Fix: gate ErrorState
  on `data === undefined` (never loaded) rather than `isError`. Plan's bug.
  Two Minors fixed in the same pass: the heading claimed "0 activities" while
  still loading, and "Plan complete" was shown for a plan with zero sessions
  (a trainer who created a plan but had not filled it in). Now three distinct
  empty copies: no plan / plan not ready / plan complete.
  Key distinction the fix rests on: TanStack Query leaves `data` undefined until
  the first success, while fetchActivePlan resolves to null for "no plan". The
  two must not be collapsed.
  Deferred to human: Step 3 browser verification.
Task 10: complete (commit d9d7225, review clean, approved)
  Controller applied the Task 9 correction pre-emptively in the dispatch: the
  brief's `if (isError)` became `if (isError && data === undefined)`, matching
  MemberHomeScreen. Reviewer confirmed the two screens agree on undefined vs
  null and that `isError && data === null` correctly shows "No plan yet" rather
  than an error.
  Minor carried to final review (both plan-authored, both in
  src/features/workout/WorkoutPlanScreen.jsx):
   - the LinearProgress `aria-label` repeats verbatim the visible Typography
     below it, which is not aria-hidden, so a screen reader announces the same
     sentence twice. Fix: aria-hidden the duplicate text, or drop the label and
     use aria-describedby.
   - `[plan.goal, plan.level].filter(Boolean).join(' - ')` leaves an empty
     coloured Typography with mb:2 when both columns are null (both are
     nullable in schema.sql) -- a dead gap.
Task 11: complete (commits 41e887b..f53f985, re-review clean, build verified)
  Controller pre-applied the offlineFirst error-branch correction to both new
  screens, plus a `if (!data) return <LoadingState />` guard so no path
  dereferences an undefined data.
  IMPORTANT found and fixed: ExerciseDetailScreen put <Divider /> -- MUI renders
  it as <hr> -- between dt/dd groups inside <CardContent component="dl">. A dl
  may contain only dt/dd groups and their single div wrapper, so that was
  invalid markup. Fix: a borderBottom on Fact's own Stack (the allowed div),
  with &:last-of-type clearing the trailing rule. Plan's bug.
  Two Minors fixed in the same pass: the exercise image had alt="" although a
  demonstration photo carries technique carried nowhere else on screen (now
  "Demonstration of <name>"), and a session with zero exercises rendered a
  heading over nothing, against the project's own no-blank-region constraint
  (now an EmptyState).
  Verified by reviewer: the route rename :exerciseId -> :sessionExerciseId is
  coherent end to end, SessionDetailScreen links a session_exercises.id, and
  BottomNav highlights Workout (not Home) on both deep routes.
  Deferred to human: Step 4 browser verification.
Task 12: complete (commit da1a07f, review clean, no findings)
  Reviewer independently rebuilt and read the precache manifest inside
  dist/sw.js -- not just the glob config -- confirming all four lazy chunks are
  precached. That is the offline guarantee: an unprecached lazy chunk turns a
  route the user has not visited into a blank screen once offline.
  Build numbers for report chapter 5:
    largest chunk  819.35 kB -> 438.56 kB (supabase vendor; app entry 335.11 kB)
    precache       14 entries / 938.53 KiB -> 28 entries / 944.48 KiB
  Total size is flat by design -- splitting moves bytes between files, the win
  is that a cold start parses less.

Phase 1 tasks 1-12 all complete. Next: final whole-branch review.

## Final whole-branch review (Phase 1)
Verdict on first pass: NOT READY. Two Criticals in shared plumbing, invisible to
all twelve per-task reviews because no single task owned them.

CRITICAL 1 (commit f909c74): postgrest-js catches network failures internally
  and RESOLVES with {error:{code:''}} instead of rejecting. AuthProvider's
  .catch() therefore never ran, profileError.offline was never true, and
  AppLayout showed an offline member "Profile unavailable -- signing out may fix
  it" with a Sign out button that offline destroys the session and strands them
  at /login. The code comment asserted the opposite of what the library does.
  Compounding it, nothing cached the profile, so a cold start offline could
  never resolve the role and the persisted query cache was never reached -- the
  offline requirement died there.
  Fix: isOfflineError on `code === ''` || !navigator.onLine, plus a localStorage
  profile cache keyed by user id, cleared before signOut. Reviewer confirmed
  `code === ''` cannot be produced by an RLS denial (42501) or an empty
  .single() (PGRST116), and that a tampered cached role grants nothing -- RLS
  governs every real read and /p is still all placeholders.

CRITICAL 2 (commit f909c74): networkMode 'offlineFirst' with retry: 2 made the
  retryer PAUSE while offline, so status stayed 'pending' forever, isError never
  fired, and ErrorState's offline copy was unreachable in exactly the case it
  was written for. Fix: retry: (n) => navigator.onLine && n < 2. Mutations'
  retry: 3 left alone -- a paused mutation is the intended Phase 2 outbox.

IMPORTANT (commit f909c74): heading outline differed on every screen. Fixed with
  component= props only, no visual change: one h1 per screen, sections h2,
  card titles h3.

IMPORTANT (commit 184e1af): ~7s blank screen on every offline cold start.
  postgrest-js retries GETs 3x with 1s/2s/4s backoff INSIDE the query function,
  so the TanStack retry predicate could not suppress it, and AppLayout returned
  null for the duration. Fix: .retry(navigator.onLine) on all six reads (the
  fixer correctly found a sixth the dispatch had missed), keeping the transient
  520/503 retry while online, plus LoadingState instead of null in AppLayout.

Also fixed in the same wave: redundant navigator guard, dead 'done' phase,
duplicated aria-label announcement, empty Typography when goal and level are
both null, and three dead-code deletions (SESSION_STATUS export, unreachable
!data guards in both detail screens, EmptyState's unused action prop).

Verdict after fixes: READY TO MERGE. lint 0, build ok, both self-checks OK.

Open Minor, not blocking: the cached profile is not refreshed on reconnect
(deps are [sessionReady, userId]); heading levels skip h2 in card lists; an
early-return ErrorState/EmptyState leaves a page with no h1.

Phase 1 COMPLETE. Everything below needs a human -- nobody in this pipeline had
a browser or a phone.

Decision (Davide, after Phase 1): do NOT pull the Sign out control forward.
There is no logout in the UI today -- signOut is wired only to AppLayout's
profile-failure branch. Switching demo accounts during verification is done
from DevTools (clear the sb-<ref>-auth-token and trainhub-profile localStorage
keys). Phase 4 owns /m/profile/settings and /p/profile/settings, and must
include the logout there. Do not re-offer before then.

# Phase 2 — Workout Deep
Plan: docs/superpowers/plans/2026-07-28-trainhub-phase-2-workout-deep.md
Base commit: 184e1af
Task 1: complete (commit 720cc1b, review clean, approved)
  Minor carried to final review (src/features/workout/timer.js): elapsedMs
  clamps a backward clock jump, but resumeTimer's `pausedTotal +=
  (now - pausedAt)` does not. A device clock corrected backwards WHILE PAUSED
  makes pausedTotal negative, which then inflates every later elapsed reading.
  Minor: formatElapsed has no internal clamp for a negative input. Unreachable
  through elapsedMs, which already clamps.
Task 2: complete (commits f1cf1ac..5b364cd, review clean after fix)
  PLAN DEFECT the implementer caught: the brief's code used Math.round for
  rewardProgress.percent while its own assertion expected 92 for 1020/1100,
  which rounds to 93. Implementer chose Math.floor to satisfy the assertion.
  Reviewer then PROVED floor is objectively right, not just assertion-fitting:
  percent 100 is reserved for the "nothing left to earn" branch, and round would
  let 1099 of 1100 read as a full bar for an unearned reward.
  BUG FOUND IN SHIPPED PHASE 1 CODE: planProgress in status.js had the identical
  defect -- 199 of 200 sessions rounds to 100 and shows a complete plan that is
  not complete. Fixed to floor, with a new assertion that would have caught it.
  Minor carried to final review: the summary self-check exercises weight: null
  but not weight: undefined, and never passes rewardProgress an unsorted array.
  Both behaviours were verified correct by the reviewer by hand; only the
  coverage is missing.
Task 3: complete (commits e273ed0..1399dd6, re-review clean)
  CRITICAL found and fixed: logSet never sent performed_at, leaving the column's
  `default now()` to fire at INSERT time. But this write is DESIGNED to pause
  offline and be replayed on reconnect -- so a set performed at 18:00 in a gym
  basement and replayed at 23:00 was recorded as 23:00, corrupting history in
  exactly the scenario the app exists for. Fix: the caller supplies performedAt,
  captured when the set is performed. PLAN was also updated so Task 6's
  LogSetSheet passes it. Plan's bug, not the implementer's.
  IMPORTANT fixed: the brief's fetchSessionLogs needed an eslint-disable to drop
  the joined row. Replaced with an explicit six-column rebuild -- no suppression.
  Confirmed by reviewer: on a replay the row already exists, so the original
  performed_at survives and the replayed value is discarded. First-write-wins on
  the field that matters.
  Minor carried to final review: fetchSessionLogs orders by the client-supplied
  performed_at, so skewed device clocks could interleave. Harmless today (the
  summary aggregates, it does not show a timeline); revisit if a timeline lands.
  Deferred to human: Step 4 browser probe against the live database.
Task 4: complete (commits 7c9d9bc..8a0daab, re-review clean) -- LOAD-BEARING
  Reviewer established from the installed query-core@5.101.4 that the mechanism
  is live, which was the thing most likely to be inert:
   - persistQueryClient dehydrates paused mutations BY DEFAULT
     (defaultShouldDehydrateMutation = m => m.state.isPaused). No dehydrateOptions
     change needed.
   - Module scope in App.jsx is genuinely early enough: restoration happens in a
     useEffect inside PersistQueryClientProvider, and effects cannot run before
     createRoot().render(), which cannot run before App.jsx's module body.
   - Mutation defaults match by PREFIX (partialMatchKey), so ['logSet'] matches.
   - A rehydrated mutation with no default rejects "No mutationFn found" and the
     cache does .catch(noop). SILENT. A future key drift would never be noticed.
  IMPORTANT fixed: onSettled read variables.sessionId, an extra property the call
  site was merely expected to pass; a caller that forgot would produce
  ['sessionLogs', undefined], match nothing and silently no-op. Replaced with
  prefix invalidation via a new `queryPrefixes` export -- immune to the mistake.
  IMPORTANT documented: defaultMutationOptions spreads the CALL SITE LAST, so a
  useMutation({ onSettled }) REPLACES the registered handler instead of composing
  with it -- invalidations would then fire only on offline replay, never online.
  Warning added to the JSDoc. Per-call mutate(vars, { onSuccess }) is a different
  mechanism and is safe. PLAN updated so Tasks 9 and 10 use queryPrefixes too.
Task 5: complete (commits 35c4f63..983aab5, re-review clean)
  Two CRITICALs and one IMPORTANT, all from the plan's own code:
   - the failed-write snackbar's `dismissed` was a plain boolean, so closing it
     once silenced EVERY later failure. A lost set with no warning is exactly
     what the component exists to prevent. Fixed by tracking dismissed
     mutationIds as a snapshot Set rather than a latch.
   - sx bottom 72px did not clear BottomNav (56px + env(safe-area-inset-bottom),
     ~90px on an iPhone), so the error rendered behind the nav. Now a calc().
   - the "persistent" banner was a normal-flow sibling of a sticky AppBar, so it
     scrolled away and was only visible at the top of the page. Fixed by making
     TopHeader's AppBar static and pinning header+banner together in one sticky
     Box at zIndex 'appBar' (1100) -- below Drawer (1200), so Task 6's log-set
     sheet will not render behind it.
  Verified by reviewer against installed packages: BottomNavigation is 56px in
  @mui/material 9.2.0; calc() with env() passes through sx untouched; react-query
  mutationIds are monotonic so a same-tick failure cannot be swallowed by an
  earlier dismissal snapshot.
Task 6: complete (commits 86a04e1..593c5a5, re-review clean)
  PROCESS ERROR (controller's): all ten briefs were extracted up front, then the
  plan was edited to add performedAt. Task 6's brief was stale and the
  implementer faithfully transcribed the older version. Briefs 6-10 were
  re-extracted. LESSON: extract a brief immediately before dispatching it, or
  re-extract after any plan edit.
  Three IMPORTANTs found and fixed, all from the plan's code:
   - a fast double-tap fired two logSet mutations with two different UUIDs for
     one physical set, so the id-based upsert dedup could not catch it and two
     rows landed. Fixed with a useRef guard reset on each opening of the sheet.
     THE OBVIOUS FIX WAS A TRAP: disabling on logSet.isPending would block every
     set after the first while OFFLINE, because an offline mutation pauses and
     stays pending until reconnect -- exactly the situation the feature exists
     for. Keyed off the `open` prop instead.
   - onError restored a whole snapshot, so with two writes in flight an earlier
     failure could clobber the later one's newer optimistic state. Replaced with
     a delta undo (decrement just this exercise's count), which is commutative
     and order-independent. onMutate no longer returns a context.
   - the Drawer had no accessible name. Added slotProps.paper role="dialog" +
     aria-labelledby, verified against the installed MUI's useSlot('paper').
Task 7: complete (commits 6f6adeb..ed83ac6, re-review clean)
  Two IMPORTANTs from the plan's code:
   - useState(() => readStored(sessionId)) runs only on first mount, but React
     Router REUSES LiveSessionScreen between two matches of the same route
     pattern -- only useParams changes. Navigating from session A's live screen
     to B's kept A's timer, and the persist effect then wrote A's clock under
     B's key. An effect cannot fix this: on the render where sessionId changes
     the persist effect fires in the same commit with stale state. Corrected
     during render.
     FIRST ATTEMPT WAS REJECTED BY LINT: this repo's eslint has
     `react-hooks/refs`, which forbids reading or writing ref.current during
     render. The fixer correctly stopped instead of suppressing. Redone with
     React's documented "adjust state when a prop changes" pattern -- a second
     useState compared during render. Controller verified lint 0 directly.
   - the clock's aria-label sat on a Typography, which renders a <p> whose
     `generic` ARIA role prohibits name-from-author, so screen readers drop it;
     aria-live="off" was also the implicit default. Removed both; the visible
     text is the accessible content.
  Minor fixed: header read "0/8 to go" for a finished workout, now "ALL DONE".
  Stale doc note: task-7-report.md still contains a "Blocked" section describing
  the abandoned useRef attempt that was never committed.
  Deferred to human: Step 5 browser verification.
Task 8: complete (commits 97ad3cb..f10e60a, review clean after fix)
  IMPORTANT fixed: two card titles rendered `variant="h3" component="h2"`,
  emitting real <h2>s where the project rule says card titles are <h3>. The
  screen had two sibling h2s and zero h3s. Plan's bug -- also corrected in the
  plan, and briefs 9/10 re-extracted so Task 9's RewardsScreen does not inherit
  it.
  Reviewer CONFIRMED the offline honesty question, which was the real risk here:
  a member who finishes a session offline has their sets sitting as PAUSED
  mutations that never reached Postgres, so fetchSessionLogs could have returned
  nothing and the screen would have celebrated a zero-set workout. It does not:
  the query fails fast offline (retry skipped both in postgrest and in the query
  client), data stays undefined, and the gate renders the offline ErrorState
  rather than a fabricated summary.
Task 9: complete (commit ec9637a, review clean, approved)
  Reviewer verified the security patch, which was the point of the task:
  Postgres runs BEFORE INSERT row triggers before conflict determination, so
  set_reward_points() fires even on the upsert path and cannot be bypassed;
  rewards has no UPDATE policy so points cannot be altered afterwards; and the
  BEFORE INSERT mutation is harmlessly discarded when ON CONFLICT DO NOTHING
  skips the row, leaving awardReward idempotent. unique (member_id, code) exists
  in that column order, matching onConflict.
  Three Minors carried to final review:
   - the patch's self-test `delete from rewards where code = 'workout:patch-test'`
     is not scoped by member_id. Harmless (no real sessionId is 'patch-test')
     but worth tightening.
   - set_reward_points() is `security definer` though it touches no tables --
     unnecessary ceremony copied from the RLS-helper convention.
   - RewardsScreen's copy "Claim your reward and show the code at the reception"
     promises a redemption code the UI never renders. Earned rows carry
     `workout:<sessionId>`, which is not a redemption code. Plan's copy defect;
     user-visible dishonesty, worth rewording.
  Deferred to human: run supabase/patches/003-award-points-server-side.sql.
Task 10: complete (commits f32f4fa..HEAD, review clean after fix)
  Implementer caught two plan bugs on their own:
   - the brief imported createSession into the screen but never calls it
     directly (it is reached through mutationKeys), tripping no-unused-vars.
   - `@mui/icons-material/DeleteOutline` does not exist in the installed 9.2.0;
     only the styled variants do. Swapped to DeleteOutlined.
  IMPORTANT fixed: `position: sessions.length + 1` is correct only while
  positions run contiguously from 1. It is not merely a concurrency race --
  against `unique (plan_id, position)` it collides DETERMINISTICALLY the moment
  any session is deleted, and Phase 3/4 is committed to building deletion. Now
  `Math.max(0, ...positions) + 1`.
  IMPORTANT fixed: a failed save showed nothing at all -- the button returned
  from "Saving..." to "Save session" and the member believed the write landed.
  Now an Alert renders create.error.
  Minor carried to final review: createSession issues two statements with no
  transaction and no idempotency key on the first, so the global retry: 3 can
  leave an orphaned empty session that no screen in this phase can delete. The
  unique constraint prevents duplication, not the ghost row.

Phase 2 tasks 1-10 all complete. Next: final whole-branch review.

## Final whole-branch review (Phase 2)
Verdict on first pass: NOT READY. Two Criticals, neither owned by any single
task, so all ten per-task reviews missed them.

CRITICAL 1 (commit 743d0be): the persister's default shouldDehydrateQuery keeps
  only status === 'success'. Offline every query refetches, fails and flips to
  'error' -- data still in memory -- and the subscriber then rewrites the whole
  IndexedDB blob WITHOUT it. First offline reopen worked; the SECOND showed an
  error on every screen. The queued writes still synced, so the app looked dead
  while actually being fine, in precisely the scenario this phase is graded on.
  Fix: dehydrateOptions.shouldDehydrateQuery = q => q.state.data !== undefined.
  Reviewer confirmed placeholderData cannot leak in (it lives on the observer,
  never on query.state.data) and that every screen already gates on
  `isError && data === undefined`, so persisting errored-but-populated queries
  is harmless.

CRITICAL 2 (commit 743d0be): starting a session offline queues 'in_progress',
  stopping it queues 'completed', and resumePausedMutations replays paused
  mutations IN PARALLEL unless they share a scope. Last PATCH won by luck, so a
  finished workout could persist as in_progress forever. Fix: scope { id:
  'sessionStatus' } on the registered DEFAULT -- not the call site, which would
  be lost on rehydration. Reviewer traced dehydrate/hydrate and confirmed the
  scope survives and replays run serially in insertion order. logSet stays
  UNSCOPED on purpose: it is an idempotent upsert on a client-generated id, so
  parallel replay is safe and faster.

Importants fixed (commits 743d0be, 5202972, 4ccd03e):
  - WorkoutBuilderScreen never gated its catalogue query; a failed read left
    options undefined and MUI's useAutocomplete calls options.filter() on popup
    open. With no errorElement in the route tree, that throw replaced the ENTIRE
    app with React Router's root boundary.
  - the builder had no offline affordance: the button sat on "Saving..." forever
    because a paused mutation never calls onSuccess. Added an info Alert and a
    "Saved offline" label. (A first attempt using onSettled was reverted -- it
    does not fire while paused either, and would have navigated away on error,
    hiding the error Alert.)
  - LiveSessionScreen had no empty state, re-introducing the exact bug fixed in
    SessionDetailScreen in Phase 1.
  - /m/workout/builder was UNREACHABLE -- nothing in src/ linked to it. A whole
    plan deliverable shipped invisible. Added the Fab the wireframe shows.
  - timer.js: resumeTimer's pausedTotal was unclamped, so a clock corrected
    backwards while paused went negative and inflated every later reading
    permanently. Clamped, with an assertion that fails under the old code.

Minors fixed: stale comment in mutations.js, literal ['exerciseCatalogue'],
rewards copy promising a redemption code that is never rendered, SQL patch's
unscoped delete and unnecessary security definer.

Verdict after fixes: READY TO MERGE. lint 0, build ok, all four self-checks OK.

Phase 2 COMPLETE. 43 commits ahead of origin, not pushed.

# Phase 3 — Professional Side
Plan: docs/superpowers/plans/2026-07-29-trainhub-phase-3-professional-side.md
Base commit: b375a01
Status: plan written, not started.

Decisions taken with Davide before planning:
  - Progress Tracking gets a real `body_metrics` table (member_id, measured_on,
    weight_kg, note), WRITTEN BY THE PROFESSIONAL during a check-in. The
    wireframe's weight/trend/check-in-note panels were unbacked by any table;
    faking them was rejected.
  - /p/clients/:id/workout is a FULL plan editor (create the plan, list, add and
    delete sessions), not just "add a session to the existing plan". A client
    with no plan was otherwise unreachable: nothing in the app could create one.
  - The calendar ships BOTH views (pt/06 week strip and pt/06B month grid). The
    spec named the month view as the first thing to cut if behind; we are ahead.

Wireframe deviations recorded in the plan, all forced by schema or RLS:
  - no `+` on /p/clients: `profiles_update_self` is the only UPDATE policy, so a
    professional cannot assign themselves a client. Adding one would let any
    professional claim any member.
  - pt/10 loses "Latest Session Note" (no table holds a member-written note).
  - pt/09 loses "View Full PDF Plan" (no PDF, no bucket, no generator).
  - pt/08 loses the "Age" pill (no date of birth) and the "Call" button (no
    phone number). Age becomes "Member since <year>" from created_at.

Task 1 ends in a human step: Davide runs supabase/patches/004-body-metrics.sql
and 005-demo-clients.sql, then re-runs verify.sql with its counts at 16.
Task 1: complete (commit bc17eba, review clean, approved)
  Reviewer verified by inspection what nobody in the pipeline can execute:
  enum casts resolve against schema.sql, every on conflict target matches a
  real unique constraint, `continue when` is valid PL/pgSQL, the auth.users
  guard correlation is valid SQL, and the three expected counts follow from
  seed.sql plus the patch. schema.sql/policies.sql stay in lockstep with the
  patch. verify.sql diff is exactly the three count changes, no whitespace churn.
  PENDING DAVIDE: run patches 004 then 005 in the Supabase SQL editor, then
  re-run verify.sql (counts now 16).
Task 2: complete (commits f6398f4..a332e2c, re-review clean)
  IMPORTANT found and fixed, plan-mandated, escalated to Davide who chose the
  wider fix: subscriptionStateOf returned SHARED module-level constants, so a
  consumer mutating the returned object would corrupt that label for every
  other client row. Identical pattern was already shipped in status.js
  (Phase 1 Task 2 saw it, rated it Minor and left it). Davide chose to freeze
  BOTH, so the two modules stay consistent. Reviewer confirmed every value
  reachable from subscriptionStateOf AND sessionStatusOf is frozen including
  the ?? TODO fallback path, that Object.freeze being shallow costs nothing
  here (every frozen object is a flat {label,color} of strings), and that no
  label or colour drifted.
  Reviewer also verified the four originals are BYTE-IDENTICAL to the brief --
  the one failure mode that would have made everything else look fine is a
  self-check edited to match a wrong implementation. It recomputed the calendar
  facts by hand (1 Mar 2026 is a Sunday, June 2026 starts Monday, 2028 is leap)
  rather than trusting the assertions, and confirmed the March case genuinely
  discriminates Monday-first from Sunday-first.
  PROCESS DEFECT (controller caught, commit a332e2c): the fix subagent ran
  git add -A and swept in unrelated tracked files. Worse, the skill helper
  sdd-workspace had rewritten .superpowers/sdd/.gitignore to a bare `*`, which
  would have untracked the ledger and every task report. Restored. LESSON:
  tell every implementer to stage only the files its task names, and re-check
  that .gitignore after any skill script runs.
  Minor carried to final review (src/features/calendar/month.js): shiftMonth
  uses Math.floor(total/12) with (total % 12) + 1, which is wrong once total
  goes negative -- shiftMonth(0, 1, -1) yields month 0. Unreachable here
  (calendar years are deep positive) and the brief never crosses zero.
Task 3: complete (commit 858be79, review clean, no findings)
  The risky part was a shared-component refactor: AppointmentCard stopped
  reading appointment.pro itself and now takes a `person` prop, because the
  same row means a different counterpart to each side. Reviewer grepped src/
  and confirmed MemberHomeScreen is the only consumer and was updated in the
  same commit -- an un-updated one renders "Unassigned" under every appointment
  with nothing throwing, no lint error and no test to catch it.
  Also confirmed preserved through the move: the task.* background by kind, the
  four-value statusLabel map, and titleAccess on the status icon (MUI hides an
  SvgIcon from screen readers without it -- the exact bug Phase 2 Task 8 fixed).
  Reviewer checked every embed names its FK constraint and every read carries
  .retry(navigator.onLine), individually, and verified the constraint names
  against schema.sql rather than assuming Postgres auto-naming.
  Minor, not worth fixing: fetchClients sort comparator never returns 0.
Task 4: complete (commit d513505, review clean, no findings)
  Reviewer traced person={appointment.member} back to the embed alias in
  fetchAgendaOnDay to confirm the direction -- passing the professional would
  have shown Coach Andrea her own name under every appointment, which looks
  plausible and is wrong. Also read the whole routes file to confirm only the
  /p index placeholder was replaced, and proved the four render states are
  mutually exclusive by construction rather than by inspection of one path.
  Deferred to human: Step 3 browser check (expect "Today - 7 activities").
Task 5: complete (commit 41bf5e3, review clean, approved)
  Reviewer proved the two empty states are mutually exclusive by construction
  and that neither can fire while data is undefined -- "No clients yet" shown
  to a professional who merely mistyped a search is a lie about their roster.
  Confirmed the status dot is aria-hidden with the label as text beside it, and
  that subscriptionStateOf is called with its arguments in the declared order.
  Minor, not fixed: the search field says "Search Client..." to sighted users
  and "Search clients" to screen readers; both come from the brief. Straight
  quotes used where the brief had curly ones.
  Deferred to human: Step 4 browser check (5 clients, 4 distinct states).
Task 6: complete (commits 566e20a..b987482, third review clean)
  THREE defects, each invisible to the check before it:
  1. IMPORTANT, rejected suppression: the implementer computed planWeek with a
     bare Date.now() in the render body and silenced react-hooks/purity with an
     eslint-disable. StrictMode double-invokes render, so the read is genuinely
     impure -- and Phase 2 Task 7 had already established that this rule family
     gets the code redone, not suppressed. Re-derived from todayISO().
  2. BUILD BREAK lint could not see: the brief imported
     @mui/icons-material/ChatBubbleOutline. That bare glyph is not shipped by
     the installed 9.2.0 -- only the styled variants are, exactly the trap
     DeleteOutline set in Phase 2. ESLint never resolves the module; Vite does,
     at build time. Plan bug, corrected in the plan too.
     LESSON: `npm run lint` is not sufficient. Every task from here runs
     `npm run build` as well. Checked every other icon name in the plan against
     node_modules -- ChatBubbleOutline was the only one missing.
  3. IMPORTANT, introduced BY the fix for 1: daysBetween sliced both arguments
     to 10 chars, which is right only when both are already the same calendar
     frame. workout_plans.created_at is timestamptz, serialised in UTC;
     todayISO() is the LOCAL day. In Europe/Rome a plan created at 23:30Z --
     locally 01:30 the next day -- read one day old, so a plan created 6 local
     days ago printed "Week 2" against the brief invariant of week 1.
     Fixed by adding localDayISO() to src/lib/format.js, with todayISO()
     delegating to it so there is one implementation rather than two.
     The gap had survived because subscription.selfcheck.js only ever passed
     plain `date` strings on both sides, never a timestamptz. New assertions in
     format.selfcheck.js were PROVEN to fail against the naive slice by
     temporarily reverting the implementation.
  Minor carried to final review: those new assertions are blind on a machine
  running exactly UTC (naive and correct agree there). Disclosed in-file.
  Deferred to human: Step 4 browser check.
Task 7: complete (commit 4519c53, review clean, approved)
  The dominant risk was rewriting a screen that already shipped: the member
  builder was gutted so its form could become the shared SessionForm.jsx that
  the professional editor also renders. Reviewer read removed against added
  lines and confirmed all six behaviours survived -- catalogue gate, the
  Math.max position, "Saved offline", the error Alert, navigate-on-success, and
  the per-row remove aria-label.
  Reviewer also went outside the diff where the diff could not answer: read
  schema.sql to confirm the delete really cascades session_exercises then
  set_logs (so the confirm copy is honest), and policies.sql to confirm
  workout_sessions_all is `for all` on owns_member, i.e. the delete actually
  succeeds under RLS for the owning professional rather than failing silently.
  Minor carried to final review: every row shares one removeSession mutation
  object, so deleting one session disables the delete button on every other row
  until it settles.
  Deferred to human: Step 7 browser checks, including the member-builder
  regression walk.
Task 8: complete (commits 6f99c09..d1ee4b5, re-review clean)
  IMPORTANT found, plan-mandated: saveNutritionPlan and saveMeal omitted `id`
  on the create path, letting the column default fire. queryClient sets
  retry: 3 on all mutations, so a create whose request COMMITS but whose
  RESPONSE is lost -- a dropped connection, not the offline case, which pauses
  before sending -- is re-run and inserts a second row. meals has
  unique(plan_id, position) so the retry at least errors loudly;
  nutrition_plans has no such constraint, so a retried "Create plan" silently
  leaves an orphan that fetchNutritionPlan's `created_at desc` hides forever.
  The codebase had already solved this twice (logSet, createAppointment); the
  nutrition writes simply missed it.
  THE OBVIOUS FIX WAS A TRAP: logSet uses ignoreDuplicates: true because it is
  insert-only. These two are ALSO the edit path -- the screen calls them with
  an existing id on every rename or macro change -- so ignoreDuplicates would
  emit ON CONFLICT DO NOTHING and every edit would silently do nothing. Fixed
  instead by having the CALLER generate the id, keeping a plain onConflict
  upsert: a retried create lands on the same row, an edit still updates.
  crypto.randomUUID() is called inside the submit/click handlers, never in a
  render body -- react-hooks/purity is live and Task 6 was already rejected
  once for suppressing it.
  NOTE: the plan document still carries the pre-fix version of these two
  functions. The committed code is the correct one.
  Minors carried to final review: meal item rows are keyed by array index, so
  deleting a row above one being edited can jump the cursor; one shared
  saveMeal mutation object disables every card's Save while any one is in
  flight; a failed save renders a screen-level Alert that does not say which
  meal failed.
  Deferred to human: Step 5 browser checks.
Task 9: complete (commit 07e5b13, review clean, approved)
  Reviewer judged the self-check as a SPECIFICATION rather than as coverage --
  it is the only verification progress.js will ever get. Recomputed the date
  windows by hand, confirmed each assertion would actually FAIL against the
  plausible wrong implementations (counting logs instead of distinct days, an
  exclusive far edge on the seven-day window, returning 0 instead of null for a
  single reading), and confirmed the noon-local fixtures survived unweakened --
  rewritten as plain ISO literals they would pass in Rome and fail in Los
  Angeles.
  Confirmed saveBodyMetric upserts on (member_id, measured_on) with NO
  ignoreDuplicates: the pair is the real-world rule and makes an offline replay
  land on the same row, while ignoreDuplicates would turn every correction into
  a silent no-op, since this is also the edit path.
  Minor carried to final review, plan-mandated: the plan query is not in the
  loading gate, so while it is still in flight the screen shows "No plan
  assigned, so there is no weekly target yet" -- indistinguishable from a client
  who genuinely has none.
  Deferred to human: Step 9 browser checks.
Task 10: complete (commit 006612c, review clean, approved)
  PLAN DEFECT the implementer caught: the brief MonthGrid imported Stack and
  never used it, which trips no-unused-vars. It removed the import rather than
  suppress -- correct, suppressions are barred in this phase.
  Reviewer did not take the "one query serves both views" claim on trust: it
  reran monthGrid/weekStrip for March 2026 and confirmed numerically that the
  edge weeks (anchored on 1 and 31 March, both padding into a neighbouring
  month) fall entirely inside the grid bounds. It also hand-traced the month
  step, confirming 31 March stepping back lands on 28 February rather than
  rolling forward into March.
  Confirmed toLocaleDateString(sv-SE) survived at BOTH sites -- Swedish
  formatting is ISO 8601, so it is the shortest correct way to a LOCAL day;
  toISOString().slice(0,10) would put a 23:00 appointment on the wrong date.
  NewAppointmentSheet.jsx committed as a `return null` placeholder: CalendarScreen
  imports it and the build fails without it. Task 11 replaces it.
  Minor carried to final review: the day heading falls back to the raw ISO
  string for any day that is not today.
  Deferred to human: Step 5 browser checks.
Task 11: complete (commits 7c55b48..c66cdce, re-review clean)
  TWO IMPORTANTs, both plan-mandated, one root cause: CalendarScreen renders
  NewAppointmentSheet UNCONDITIONALLY -- only the Drawer open prop toggles
  visibility -- so the component never unmounts and useState reads its
  initialiser exactly once, at first mount. Consequences: (a) selecting next
  Tuesday then tapping + opened the sheet on the day the screen first loaded,
  failing the plan own acceptance test; (b) after a booking nothing was reset,
  so reopening showed the previous client, kind, time, duration and notes, and
  a professional changing only the client silently carried the rest across.
  Fixed with React documented adjust-state-when-a-prop-changes pattern -- a
  second useState compared during render -- NOT an effect. Same call Phase 2
  Task 7 made for LiveSessionScreen: on the render where the prop changes an
  effect fires in the same commit with stale state. A ref was barred too, this
  repo eslint has react-hooks/refs.
  Reviewer confirmed the reset fires on closed->open only, not on open->close
  (which would fight the Drawer transition) nor on every render (which would
  make every field uneditable), and that setState during render means React
  discards the stale render before painting -- no flash of the wrong day.
  Reviewer also confirmed ignoreDuplicates: true is right HERE, unlike Task 8:
  booking is insert-only, so a replayed write must be a no-op. It checked there
  is no call site passing an existing appointment id.
  Minor carried to final review: the status Chip maps pending and confirmed to
  the same colour, so they differ only by label text.
  Deferred to human: Step 6 browser checks including the offline round trip.
Task 12: complete (commit c66782d, review clean, approved)
  PLAN DEFECT the implementer caught, same class as Task 10: the brief screen
  imported addAvailability and deleteAvailability, but the screen never calls
  them -- it reaches them through mutationKeys and the registered defaults.
  Two no-unused-vars errors. Removed the imports rather than suppress.
  Reviewer confirmed this leaves nothing orphaned: mutations.js still imports
  and registers both, so the keys are now the SOLE link between screen and
  implementation -- which is exactly the arrangement the persister needs.
  Reviewer specifically checked the weekday convention, the one mistake here
  that would silently shift every professional hours by a day with nothing in
  the app announcing it: the select value is the real Postgres index (0 is
  Sunday), and only DISPLAY_ORDER changes what the user sees. Storage unchanged.
  ignoreDuplicates: true confirmed right here -- this screen has no edit path,
  only add and delete.
  Minor carried to final review: invalidRange compares HH:MM strings
  lexicographically. Correct for zero-padded 24h, fragile if the format ever
  changes; worth a comment.
  Deferred to human: Step 5 browser checks.

Phase 3 tasks 1-12 all complete. Next: final whole-branch review.

## Final whole-branch review (Phase 3)
Verdict on first pass: NOT READY. Seven findings, none owned by any single task,
so all twelve per-task reviews missed them.

IMPORTANT 1 (commit a3e97dd): /p/calendar/availability was UNREACHABLE. Nothing
  in src/ linked to it -- a whole task deliverable, 190 lines with its own
  review, findable only by typing the URL. This is Phase 2 final review repeated
  verbatim (/m/workout/builder shipped invisible for the same reason). Added the
  link to CalendarScreen header.
IMPORTANT 2 (a3e97dd): saveNutritionPlan and saveBodyMetric were UNSCOPED while
  their sibling saveMeal was scoped, with a comment explaining exactly why the
  scope was needed. Reachable path: a professional edits the kcal target
  offline, the mutation pauses, they reload the PWA -- the new observer isPending
  is false and the cached screen still shows the OLD value, so it reads as lost.
  They re-enter it. Two paused upserts on one row, replayed in PARALLEL, and the
  stale one can land last. Same shape as the Phase 2 setSessionStatus Critical.
IMPORTANT 3 (a3e97dd): createPlan was the one write in the phase with no
  idempotency key -- plain insert, and workout_plans has no unique constraint, so
  a retried or resubmitted create leaves an orphan that fetchActivePlan
  `created_at desc limit 1` hides forever. Identical to the defect Task 8 review
  found in saveNutritionPlan; createPlan was written in Task 7 and never got the
  same treatment. Now a caller-generated id with ignoreDuplicates -- correct here
  because creating a plan is insert-only.
IMPORTANT 4 (a3e97dd): ClientDetailScreen overview cards branched only on
  undefined vs null and never consulted isError, so offline they showed a
  permanent "Loading..." with no error, no offline wording and no retry -- a dead
  region on the graded offline path.
IMPORTANT 5 (5551a0a): verify.sql reports four FAILs once patch 005 has run, and
  the Task 1 handoff told Davide every check would still pass. Fixed with a
  comment rather than by bumping the expectations: bumping them would break the
  fresh-install-without-demo-data path, which is the whole reason the schema
  patch and the demo patch are separate files.
Also fixed: ClientProgressScreen printed "No plan assigned" while the plan query
  was still in flight; CalendarScreen rendered a raw ISO date as an h2; the
  offline banner said "your workout still works" on the professional screens;
  queryPrefixes.clients was declared and never invalidated, so the roster goal
  went stale after createPlan; two dead/fragile lines in AvailabilityScreen.

Verdict after fixes: READY TO MERGE. lint 0, build ok, all 8 self-checks OK.
Re-review recomputed the post-patch seed counts independently and confirmed the
new comment is accurate, and confirmed the Schedule icon exists in the installed
9.2.0 -- this phase had already shipped one broken icon import that passed lint.

Open Minor, deferred with reasons: shiftMonth is wrong once its month total goes
negative (unreachable); the format self-check assertions are blind on a machine
running exactly UTC; the meal item rows are keyed by array index; several shared
mutation objects disable sibling controls while one is in flight; the status
Chip gives pending and confirmed the same colour. The loading/error idiom is
still split across the eleven new screens -- some render inline under a
persistent h1, others early-return and leave a page with no h1. Phase 1 recorded
the same split; it now spans eleven more screens and is worth one pass.

Phase 3 COMPLETE. 21 commits on branch phase-3-professional-side, not merged.
EVERYTHING BELOW NEEDS A HUMAN:
  - run supabase/patches/004-body-metrics.sql then 005-demo-clients.sql
  - the per-task browser checks listed above, and the member-builder regression
    walk from Task 7

## Post-merge defect: table grants lost by the schema reset
Symptom: login reached the app shell and died on "Profile unavailable" for BOTH
demo accounts, while verify.sql reported every security check PASS.

The profiles request returned:
  42501  permission denied for table profiles
  hint: GRANT SELECT ON public.profiles TO authenticated

That is a table GRANT denial, not an RLS denial -- Postgres checks the grant
BEFORE it evaluates any policy, so RLS was never consulted.

ROOT CAUSE, and it was the controller's: early in the session Davide hit
`type "user_role" already exists` from a half-applied schema.sql, and was given
`drop schema public cascade` to start over. That statement also destroys the
grants Supabase installs on public. The recovery snippet included
`grant all on all tables in schema public`, which applies ONLY to tables that
exist at the instant it runs -- and it ran against a freshly created, empty
schema. Every table schema.sql created afterwards was born unreachable. The
snippet also omitted `alter default privileges`, which is what makes future
tables inherit the grant.

Why nothing caught it: verify.sql checked that RLS was enabled and that every
table carried a policy, but never that the app role could actually reach the
table. Perfect RLS with no grant passes both checks and denies every request --
the same SHAPE as the Phase 0 finding that RLS-on-with-zero-policies passes a
rowsecurity check while breaking every read.

Fixed in patches/006-restore-public-grants.sql, plus two new rows in verify.sql
(`tables the app role can read` / `can write`) that fail against the broken
state and pass after the patch.

Still to watch, same cause: `drop schema public cascade` also drops the tables
from the `supabase_realtime` publication. Nothing in Phases 0-3 uses Realtime,
so it is invisible today -- Phase 4 chat is where it will surface.

# Phase 4A — Member Completion and Chat
Plan: docs/superpowers/plans/2026-07-29-trainhub-phase-4a-member-completion-and-chat.md
Base commit: a82c899
Branch: phase-4a-member-completion-and-chat
Status: starting.

Scope split decided with Davide: Phase 4 in the spec is five independent
subsystems and ~15 screens. 4A takes everything verifiable in a browser
(nutrition, trainer section, booking, profile, settings + logout, chat with
Realtime); 4B takes the two device-dependent features (push via Edge Function,
QR badge and scanner) where all the environmental risk lives.

Decisions taken before planning:
  - Push gets the FULL Edge Function + DB trigger, not a client-side fake:
    only that notifies with the app closed, which is the test the spec states.
  - The QR badge uses a checkin_tokens row with an expiry, not a client-signed
    token: signing with a secret that ships in the bundle is not security.
  - jsQR fallback AUTHORISED by Davide -> a new dependency, in 4B. A second one
    (qrcode) is needed to GENERATE the badge; flagged, also 4B.
Task 1: complete (commit b6e3e2f, review clean, approved)
  Reviewer confirmed messages.id has no database default in schema.sql, so the
  client-supplied id + ignoreDuplicates is right HERE (sending is insert-only),
  and contrasted it against nutrition.js which deliberately omits
  ignoreDuplicates because those functions are also the edit path.
  Both writes share scope on the REGISTERED DEFAULT, which is what survives
  rehydration; both Realtime guards present in the right order (undefined check
  before the duplicate scan) with removeChannel cleanup on unmount and on
  threadId change.
  Confirmed the threads embeds name their FK constraints -- threads references
  profiles twice, and an unqualified embed 300s at runtime with "more than one
  relationship was found".
  SECURITY observation for the final review, PRE-EXISTING and outside this diff:
  messages_update_read (policies.sql) has a USING clause and no WITH CHECK, so
  Postgres reuses USING for both -- any thread member can UPDATE any message in
  a thread they belong to, including flipping read_at back to null or editing a
  row they did not send. markThreadRead itself is safely filtered; the policy is
  broader than the app needs.
  PENDING DAVIDE: run supabase/patches/007-realtime-messages.sql. Its final
  select must list `messages` -- if it does not, Realtime reports SUBSCRIBED and
  never fires, which is the worst possible failure mode.
Task 2: complete (commits 1f3d581..1763082, re-review clean)
  THREE findings, two of them defects in the plan own code:
  1. IMPORTANT: the read-receipt effect was guarded by a ref holding the thread
     id already marked -- a permanent gate for the component lifetime, not a
     per-batch one. After the first batch was marked, every later message
     arriving over Realtime while the thread stayed mounted never marked as
     read. Receipts silently stopped for the rest of the session. The guard
     could not just be deleted: Realtime pushes re-render the screen and an
     unguarded effect writes once per push. Fixed by keying the ref on the id of
     the NEWEST UNREAD message instead of the thread, so it re-fires per batch
     while re-render churn still collapses to zero extra writes.
  2. IMPORTANT: the thread-creation effect guarded on isPending || isSuccess but
     not isError, and the mutation object identity changes on every state
     transition -- so a failed ensureThread re-ran the effect, passed the guard,
     and fired again immediately with no backoff. An uncontrolled retry loop
     against the backend, with the member shown nothing but a permanent loading
     state. Fixed on both halves: the guard blocks on error AND an ErrorState
     with Retry now surfaces it.
     ensureThread was also the ONE write in the app with no registered handler
     (inline mutationFn). Now registered like every other.
  3. MINOR: a dangling `pending` prop was still passed to MessageComposer after
     the prop was removed from it. Deleted.
  PLAN DEFECT the implementer caught: the brief MessageComposer declared a
  `pending` prop it never read, tripping no-unused-vars. Removed rather than
  suppressed -- third time this class has appeared in the two phases.
  Minor carried to final review: ensureThread registration omits the chat scope
  its two siblings share. Harmless -- unique(member_id, pro_id) already makes
  concurrent creates idempotent.
  Deferred to human: the two-browser Realtime check.

Davide, after task 2: patch 007-realtime-messages.sql HAS BEEN RUN, and the
Phase 3 browser verification HAS BEEN DONE -- no defects reported back. So the
long "deferred to human" list from Phase 3, including the member-builder
regression walk from Task 7, is closed. Realtime is live; the two-browser chat
check at the end of Task 2 is the only chat verification still outstanding.

CLAUDE.md rewritten at this point. It had been frozen at Phase 0 and every
stack claim in it was false ("src/ is still the stock Vite React template",
"MUI is installed but not yet used anywhere", "No router installed yet", "Not a
git repository") -- a fresh session read it first and started from a completely
wrong model of the project. It now carries the architecture, the location of
this ledger, and the rules-that-cost-a-day list distilled from four phases of
review findings.
Task 3: complete (commit d8b7b3f, review clean, approved)
  Verbatim implementation of the brief; reviewer independently confirmed
  fetchThreads' return shape matches what the screen destructures, that
  SearchIcon is already used elsewhere in the repo (the lint-passes/build-breaks
  icon trap), and that the h1/h3 variants map to the right levels without a
  component= override. No findings at any severity.
  Deferred to human: the /p/chat browser walk (unread badge of 1, badge clears
  after the receipt, "To Read" then shows Nothing unread, `zzz` gives No match).
Task 4: complete (commit dca2a58, review clean, approved)
  The bell prop TopHeader has taken since Phase 0 is finally fed. Reviewer read
  the whole of AppLayout rather than the diff context and confirmed all four
  early returns (loading, !user, !profile, wrong role) sit BELOW the new
  useQuery -- the one way this task could have broken rules-of-hooks. No
  findings at any severity.
  Deferred to human: bell reads 1 for Andrea before opening the chat and 0
  after; 0 for Daniel until Andrea sends something.
Task 5: complete (commit eb1bc67, review clean, approved)
  Reviewer independently confirmed the three cross-file shapes the brief only
  asserted: weekStrip returns {dateISO, day, weekday} which is what WeekStrip
  documents, fetchNutritionPlan's null-vs-{plan,meals} contract is what both
  screens destructure, and meals[].items {food, qty} matches the field names the
  Phase 3 professional editor WRITES -- a mismatch there would have rendered
  blank rows with no error. palette.task.nutrition and ChevronRight both exist.
  No findings at any severity.
  Deferred to human: /m/nutrition as Daniel (Lean Bulk, 2600 kcal, three macros,
  four meal cards; Breakfast lists Oats/Whey/Banana), and the 03B empty branch
  as a client with no nutrition plan.
Task 6: complete (commit f0a868a, review clean, approved)
  First member-side profile write. Reviewer verified the whole registration
  chain -- key from mutationKeys, same setMutationDefaults shape as its
  siblings, and the only call site passes mutationKey at the hook with
  { onSuccess } per-call, never onSettled -- plus that AuthProvider's select
  list actually contains every profile field the two screens branch on, and
  that the pro_specialty enum in schema.sql matches the filter's three values
  so the filter cannot silently match nothing.
  Accepted as designed, from the plan: choosing a professional finishes with
  window.location.assign('/m/trainer'). AuthProvider holds `profile` outside the
  query cache, so no invalidation can refresh `assigned_pro_id`; a full reload
  is the plan's chosen answer and both the registration and the call site
  document it. An AuthProvider refresh is the real fix and is noted as future
  work.
  Two Minor carried to the final review: the "No match" empty state cannot
  distinguish a filter that excluded everyone from an empty professionals table;
  the '?' avatar initial fallback.
  Deferred to human: /m/trainer as Daniel shows Coach Andrea; clearing
  assigned_pro_id by SQL redirects to browse and the picker re-assigns.
Task 7: complete (commit 413fc71, review clean, approved)
  The implementer went one step outside the brief's file list and was right to:
  createAppointment's registered onSettled invalidated queryPrefixes.agenda
  only, and TanStack prefix matching is positional, so ['agenda', proId, ...]
  never matches the member's ['appointments', memberId, ...] keys. A freshly
  booked appointment would not have appeared in the member's own list. Reviewer
  confirmed against git show f0a868a that this was a PRE-EXISTING gap -- it also
  affected MemberHomeScreen's appointmentsOnDay since Phase 2 -- and that the
  new queryPrefixes.appointments invalidation is purely additive: the
  professional's screens are all agenda-prefixed and cannot be reached by it.
  Fixed at the shared registration, not at the call site. Disclosed, not
  smuggled.
  Also verified: the booking id comes from crypto.randomUUID() inside onSubmit
  (react-hooks/purity), every ISO<->Date conversion computes in the local frame,
  and the two pieces of pure logic (slotToISO, the month-step clamp) are
  byte-identical to already-shipped Phase 3 code whose underlying arithmetic
  month.selfcheck.js already covers -- so no new self-check was owed.
  One Minor carried to the final review: dayOf() reimplements
  toLocaleDateString('sv-SE') instead of calling localDayISO from format.js. It
  matches CalendarScreen's pre-existing idiom, so BOTH sites want one pass.
  Deferred to human: the seeded dots, a live booking as Daniel, Coach Andrea
  confirming it, and the 31 March -> 28 Feb month step.
Task 8: complete (commits 18dbdd4..21956b3, re-review clean)
  ONE CRITICAL, and it was the PLAN's: the brief asserted "no new reads --
  useAuth().profile already holds everything both screens show", which is false.
  PROFILE_COLUMNS in AuthProvider selects subscription_status but NOT
  subscription_until, so the subscription screen's whole reason to exist was
  broken two ways: "Valid until" always rendered an em dash, and
  subscriptionStateOf treats a missing `until` as open-ended -- so a member whose
  date had passed while subscription_status still said 'active' was shown as
  ACTIVE. That is precisely the case the date check in subscription.js was
  written to catch, defeated by the select list. Neither lint nor build can see
  a missing column; it reads undefined with no error.
  Fixed at the root: one field added to the single select list that feeds
  `profile`. Re-review confirmed PROFILE_COLUMNS has exactly one definition and
  one call site (no initial/refresh split still missing it), that every other
  field both screens read is in the list, and that the fix left AuthProvider's
  forUserId/readiness machinery -- flagged in its own comments as previously
  broken -- byte-for-byte untouched.
  One Minor carried to the final review: SubscriptionScreen renders a bare '#'
  for the membership id if `profile` is ever null on that route (no loading
  guard); it matches the brief's reference code.
  Deferred to human: /m/profile and /p/profile link sets, and
  /m/profile/subscription showing the date eight months out with an Active chip.
Task 9: complete (commits 200cb21..d469d26, re-review clean)
  TWO IMPORTANT, both in the plan's own code:
  1. Double submit on the password form. The "New password" onChange reset the
     status to idle whenever it was not idle -- INCLUDING while saving -- neither
     field was disabled during a save, and onSubmit guarded only on mismatch and
     emptiness. Typing one character mid-save re-enabled the button and a second
     click fired a second concurrent supabase.auth.updateUser. Fixed on both
     halves: the phase is in the submit guard AND both fields disable while
     saving, with the deliberate "clear a stale result when the user starts over"
     behaviour kept for idle/done/error.
  2. The persisted query cache survived logout. signOut cleared only the
     trainhub-profile localStorage key, and AppLayout navigates client-side with
     no reload -- so the in-memory QueryClient and its IndexedDB mirror
     (trainhub-query-cache via idb-keyval) both survived. The outgoing user's
     messages, nutrition plan, body metrics, appointments and session logs stayed
     readable in cleartext IndexedDB via DevTools for up to the one-week gcTime,
     on the shared browser this very task exists to make switchable. Per-user
     query keys stop a LATER signed-in user's screens from rendering that data;
     they do not remove it from the device. Fixed at the root, inside signOut, so
     AppLayout's profile-failure branch benefits too, on the unconditional path
     that runs even when the network call fails. Discarding paused mutations is
     the intended trade on a deliberate sign-out and is commented as such.
  The brief mandated neither: it asserted signOut "already clears the cached
  profile ... Do not reimplement it here", which is true and insufficient.
  Also confirmed correct and left alone: the password change deliberately does
  NOT go through useMutation. Reviewer checked GoTrueClient's source -- an
  offline updateUser resolves to {data, error} rather than rejecting, so the
  error branch catches it; and a password change is the one write that must
  never pause and replay.
  One Minor fixed in the same pass: the confirm field did not reset the status
  banner the way its sibling did.
  One Minor carried to the final review: the cache clear relies on IndexedDB
  same-store transaction ordering for the case where a persist write is already
  mid-flight when removeClient() runs. It holds, but nothing in the code says so.

ALL NINE TASKS COMPLETE. Next: whole-branch review, then finishing-a-development-branch.

## Phase 4A whole-branch review (base a82c899, 14 commits at review time)
ONE CRITICAL, FOUR IMPORTANT, all cross-task -- the pattern holds for a fifth
phase: no single task owned any of them.

CRITICAL (security, pre-existing but this branch is what made it reachable):
  messages_update_read in policies.sql has a `using` clause and no `with check`,
  so Postgres reuses `using` for both. With patch 006's `grant all on all
  tables`, ANY thread member could UPDATE any row in a thread they belong to --
  rewrite a message body they did not send, or set read_at back to null so the
  badge sticks. Every sibling policy in the file carries an explicit `with
  check`; this was the only one that did not. Nothing used `messages` before
  Phase 4A, which is why four phases of review never surfaced it.
  Fixed in patches/008-messages-update-read.sql at TWO layers: `revoke update`
  then `grant update (read_at)` -- the column grant is load-bearing because
  Postgres checks grants BEFORE policies -- plus the recreated policy with an
  explicit `with check` carrying the membership test AND `read_at is not null`.
  Re-review confirmed markThreadRead is the app's only messages UPDATE, so the
  revoke breaks nothing, and that verify.sql's grant rows ask about select and
  insert only, so they still PASS.
IMPORTANT 1: the chat was not live anywhere except inside an open conversation.
  staleTime 30s, refetchOnWindowFocus false, and the only Realtime channel is
  filtered to one thread_id and mounted only on ThreadScreen -- while AppLayout
  never unmounts, so its unreadCount observer is created once per page load. A
  member sitting on /m saw the bell frozen at its page-load value forever; a
  professional on /p/chat never saw a message arrive. Three tasks each did their
  own half correctly (Task 1 scoped Realtime to one thread, Task 3 built the
  inbox, Task 4 built the badge) and nobody owned the seam. The Task 4 human
  check as written -- "1 before opening the chat, 0 after" -- passes on a reload
  and never exercises liveness. Fixed with refetchInterval 60s on both queries,
  deliberately not a second Realtime channel.
IMPORTANT 2: ThreadScreen rendered the composer while threadId was null (a
  member with an assigned pro but no threads row yet). Online the window is
  milliseconds; OFFLINE IT IS PERMANENT, because ensureThread pauses and its
  onSuccess never fires -- so a message typed there queued with thread_id null
  and failed the not-null constraint on reconnect. Lost message, on the app's
  flagship offline path. Composer now gated on threadId, and the indefinite
  spinner replaced with copy.
IMPORTANT 3: two comments claimed an optimistic insert that did not exist
  ("already queued and rendered", "the sender already has this row from its own
  optimistic insert"). onMutate appeared exactly once in the repo, in
  LogSetSheet. Offline a sent message simply vanished. Fixed by adding the
  onMutate the comments described.
IMPORTANT 4: fetchMemberThread used .eq('member_id').maybeSingle(), but threads
  is unique (member_id, pro_id) -- one thread per PAIR. The picker supports
  switching professional, which creates a second row, after which PostgREST
  answers PGRST116 and the member's chat becomes a permanent ErrorState whose
  Retry can never succeed. Not reachable with the shipped seed (one professional)
  and reachable the moment a second exists. Fixed by scoping the lookup to
  assigned_pro_id and widening queryKeys.memberThread.
  The fixer found a second-order bug the review missed: gating on proId left an
  UNASSIGNED member on an eternal spinner, because the isPending early return sat
  above the "No trainer yet" one. The two are now ordered deliberately with a
  comment; re-review walked all five states and confirmed no regression.
Also fixed: an isPaused Alert on chooseProfessional (offline it disabled every
  button with nothing explaining why, unlike its two siblings on this same
  branch); slotToISO deduplicated into lib/format.js with self-check assertions
  that fail a UTC-frame regression in BOTH hemispheres (re-review re-ran them
  under five timezones); three inline reimplementations of localDayISO replaced;
  the picker's "No match" state split into two branches; ensureThread's missing
  chat scope; and, in a final pass, two comments in mutations.js that claimed
  onMutate reruns on a replay (it does not -- query-core skips it when the
  mutation is restored; the optimistic row survives a reload because the query
  cache is persisted) plus a missing cancelQueries in that onMutate.

Verdict after fixes: READY TO MERGE. lint 0, build ok, all 8 self-checks OK.

EVERYTHING BELOW NEEDS A HUMAN:
  - RUN supabase/patches/008-messages-update-read.sql. All five rows must read
    PASS and `app role can update body` must read false. It must run AFTER 006;
    replaying 006 silently reopens the Critical.
  - the two-browser Realtime round trip (still the one chat check never done)
  - the per-task browser walks listed under tasks 3-9 above
  - DECISION: patches/008 fixes messages_update_read but policies.sql still
    declares the vulnerable version, so a fresh install (schema -> policies ->
    seed) has the hole open until 008 runs. Patch 001 set the opposite precedent
    -- it amended policies.sql too, which is why the fresh-install path is safe
    there. Either amend policies.sql for consistency, or revert 001's amendment
    and keep "patches only" as the rule.
Open Minor, deferred with reasons: unread messages in an abandoned thread still
  count toward the badge and the member has no route to clear them (FIX 5 made
  this state work at all, so this is an improvement, not a regression); the
  professional's ThreadScreen shows "Chat" instead of the client's name, while
  the inbox one tap earlier shows it; patch 008's `with check` still lets a party
  stamp read_at on their OWN message, suppressing the recipient's badge for it
  (cosmetic, blocked at the body level, one line to harden with
  `and sender_id <> auth.uid()`); BookingSheet lets a member book a slot outside
  the professional's availability -- the plan asserted the booking sheet reads
  availability_select_all and its own code never does, so this is plan-mandated
  and is Davide's call; the loading/error idiom split now spans five more
  screens, and eleven files of mechanical change is the wrong thing to do in a
  pre-merge scramble -- pick the inline idiom and do it as one commit after merge.

DECIDED with Davide after the whole-branch review: policies.sql gets the fix
too, following patch 001's precedent (commit dd6254a). The `with check`
predicate is byte-identical to the one in patches/008, so an existing database
and a fresh install end in the same state -- except for the column grant, which
only 008 carries, because policies.sql does not do grants. A fresh install
therefore still needs 008 for the half that keeps `body` unwritable, and the
comment in policies.sql says so.
Branch left unmerged by choice: merge after 008 has been run and the two-browser
Realtime round trip has passed, since 008 is what makes Realtime real.

## Device verification, 2026-07-30 (Davide, real Android phone over ngrok)
patches/008 APPLIED. Two-device chat round trip PASSES -- Realtime is real, and
the last open chat verification from Task 2 is closed.
Install, standalone launch, theme and offline relaunch all pass.
Offline cold start, offline set logging and the double-tap guard all pass.

Found by the device run, and fixed (commit 2f65ac6):
  The second tick was not live. The subscription listened for INSERT only, so a
  read receipt -- an UPDATE of read_at -- never reached the sender, whose own
  threadMessages query has no refetchInterval and no refetch on focus. The tick
  therefore waited for the next message either side sent and could sit unseen
  for the rest of the conversation. Added an UPDATE handler that replaces the
  row in place, returning the same array identity when the row is not held so a
  receipt does not re-render every bubble. No invalidation on that path: a
  receipt changes nothing the recipient of the event counts.
  This is what patches/007's `replica identity full` was set for, and
  patches/008 is what makes the handler safe to trust -- read_at is now the only
  column the app role may update, so an UPDATE on `messages` IS a read receipt.

CHECKLIST DEFECT, mine: the verification file told Davide to look for
Lighthouse's PWA audits (installability, apple-touch-icon, themed omnibox,
splash). Lighthouse 12 REMOVED the PWA category -- there is nothing to find.
Installability now lives in DevTools > Application > Manifest / Service Workers.
The file is corrected.
Lighthouse on the login screen: 96 performance / 94 accessibility /
96 best practices / 82 SEO. The 82 was index.html never having a
<meta name="description">; added in the same commit, mirroring the manifest's
sentence. Re-run pending.

Confirmed correct, recorded so nobody "fixes" them later: a route never visited
online has no data offline (the code is precached, the data was never fetched);
finishing a session offline refuses to render a summary (Phase 2's deliberate
refusal to celebrate sets that never reached Postgres); signing in offline is
impossible. The rule: an error on a screen holding no usable data is correct, an
error banner ABOVE data the app already has is the defect.

## Device run, part 2 (2026-07-30) -- the password reset was broken since Phase 1
Davide created a user with a REAL mailbox and ran the reset flow. Supabase sent
the link; opening it rendered "Link not valid" every time.

ROOT CAUSE, a Phase 1 defect that four phases of review never saw:
  ResetPasswordScreen reads `?code=` from the query string and starts in the
  `invalid` phase when it is absent. src/lib/supabase.js created the client
  WITHOUT `flowType`, and @supabase/auth-js@2.110.9 defaults to `implicit`
  (GoTrueClient.js:21). The implicit flow returns a recovery session in the URL
  FRAGMENT (#access_token=...&type=recovery) and never produces a code, and
  `detectSessionInUrl: false` stopped the library picking the fragment up on its
  own. So the screen waited for something that flow cannot emit -- every reset
  link, always.
  The irony worth recording: Phase 1's fix for StrictMode double-invoking the
  single-use PKCE exchange was protecting code that could never execute.
Fixed in commit e7631e5 with `flowType: 'pkce'`. Verified that only
resetPasswordForEmail and exchangeCodeForSession are flow-sensitive -- the app's
other four auth calls (signInWithPassword, getSession, signOut, updateUser)
behave identically either way. Its cost is that the emailed link must be opened
in the browser that requested it, because the verifier lives in that browser's
storage; the invalid-link copy already said so.

WHY NOTHING CAUGHT IT: the check was deferred to a human in Phase 1 as "needs a
real reset email", the demo accounts use a fake domain (trainhub.dev, created
with Auto Confirm precisely to skip email), and every later phase inherited the
deferral. A browser could not catch it; only a real mailbox could. This is the
strongest argument yet for running the deferred human checks BEFORE a phase
merges rather than after.

Also confirmed on device: password change works (the one write deliberately
outside the offline mutation pipeline); /m/profile/badge and /p/scan correctly
still Placeholder, they are Phase 4B.

Operational note, learned the hard way 2026-07-30: Davide deleted the
daniel@trainhub.dev auth user while testing the reset flow, which cascaded from
profiles through every table that references it -- plan, sessions, set logs,
nutrition, appointments, thread, messages, rewards, check-ins. Fully
recoverable, because seed.sql looks the two demo users up BY EMAIL rather than
by a hard-coded uuid and upserts their profiles: recreate the auth user with the
same address and Auto Confirm, then re-run seed.sql. The one thing to clear
first is Andrea's availability -- it is pro-owned, so it SURVIVES the cascade,
and seed.sql inserts its ten rows unguarded:
  delete from availability
  where pro_id = (select id from auth.users where email = 'andrea@trainhub.dev');
Everything else seed.sql inserts unguarded belongs to the member and was already
gone. patches/005 is idempotent and only needs re-running if a demo client was
deleted too.

PHASE 4A MERGED into main via pull request #2 (merge commit d6d4c08), after the
device run above. Branch phase-4a-member-completion-and-chat is on origin.
Remaining routes: /m/profile/badge and /p/scan, both still Placeholder -- they
are Phase 4B, together with push notifications.

# Phase 4B — Access Badge, Scanner and Push
Spec: docs/superpowers/specs/2026-07-31-trainhub-phase-4b-design.md
Plan: docs/superpowers/plans/2026-07-31-trainhub-phase-4b-badge-scanner-and-push.md
Base commit: 60d15ba
Branch: phase-4b-badge-scanner-and-push
Status: starting.

Decisions taken with Davide before planning (spec carries the reasoning):
  - The badge ROTATES every 60s, one row per token, redeemable once. A token
    per day or a static token means a forwarded screenshot is a working key.
  - BarcodeDetector DROPPED. jsqr only -- one code path, and the only one that
    works in Chrome on Windows, where the native decoder does not exist and the
    two-path version would leave its native branch untestable on the dev machine.
  - Three notification EVENTS, four triggers (a plan spans two tables).
  - The notification is raised by the database, not the sender's client.
  - A token is redeemed through a security definer function; a professional
    never receives read access to checkin_tokens, which is the permission that
    would let someone enumerate valid badges.
  - Push verified on Android AND iPhone (iOS 16.4+, installed from Safari).
Pre-flight plan scan: clean. The two Global Constraints that look like
  contradictions -- two writes not registered in mutations.js, and one
  TypeScript file -- are both carved out explicitly in that section.
Task 1: complete (commits f3ed4fd..7446465 plus the plan fix, re-review clean)
  ONE IMPORTANT, and it was the plan's -- mine. redeem_checkin_token is
  `security definer`, so it bypasses RLS, and it was declared
  `set search_path = public` with unqualified relation names. Postgres resolves
  an unqualified RELATION through pg_temp BEFORE anything on the search path,
  and any signed-in role may create temp tables: a professional -- who
  legitimately passes the is_professional() gate -- could create a session-local
  temp table named checkin_tokens holding a forged row and have the function
  read the forgery, recording a check-in for a member who never scanned.
  Fixed with `set search_path = ''` and every relation, %rowtype and function
  reference schema-qualified. auth.uid() was already qualified; now() and the
  casts need no qualification because pg_catalog is searched first whatever the
  search path says, and pg_temp shadows only RELATIONS, never functions or
  types. The patch gained a PASS/FAIL row asserting the empty search path, so a
  future edit that puts `search_path = public` back fails when the patch runs.
  The same shape was in the plan's Task 4 SQL, which had not been implemented
  yet -- corrected there too, before it could be inherited. That mattered more
  than it looks: notify_user reads app_config, which holds the secret that
  authenticates the database to the Edge Function.
  Re-review caught that the plan's PASS/FAIL block had not received the new
  assertion even though its function body had. Fixed.
  PRE-EXISTING, for the final review to triage: is_professional() and
  owns_member() in policies.sql, and handle_new_user() in schema.sql, carry the
  same `search_path = public` + unqualified pattern. Not a regression from this
  branch, and hardening them means re-running a policies-level patch.
  PENDING DAVIDE: run supabase/patches/009-checkin-tokens.sql. Seven rows, all
  must read PASS.
Task 2: complete (commits b275ece..9206c65, third review clean)
  TWO IMPORTANT in the plan's own code, then ONE CRITICAL introduced by the fix
  for them. Worth recording in full, because the second is the more instructive.
  1. IMPORTANT: one expiry could mint SEVERAL tokens. tick() called mint()
     without awaiting it and with no in-flight guard, and badge.expiresAt does
     not change until the insert resolves -- so every tick during the round trip
     saw the same past expiry and minted again. One extra database row per
     second of latency; a 3s insert wrote four badges for one expiry.
  2. IMPORTANT: the async mint could settle after unmount and set state on a
     screen the member had already left.
  Fixed with a mintingRef owned by mint itself (so the mount effect, the expiry
  tick and the visibility handler are all covered rather than one call site) and
  an aliveRef unmount guard.
  3. CRITICAL, introduced BY that fix: aliveRef was set false in a cleanup and
     never back to true. main.jsx wraps the app in StrictMode, and React 19
     double-invokes effects in dev -- mount, cleanup, mount -- so the flag was
     permanently false and every setBadge/setError was dropped. The badge sat on
     its spinner forever under `npm run dev`, recoverable only by a reload. The
     screen's own verification step is a dev browser check, so this would have
     been found by Davide as "the badge never appears" with no clue why.
     Fixed by re-arming the flag at the top of the effect body. ResetPasswordScreen
     carries the same hazard and its comment already named it -- the house
     precedent existed and the fix had not followed it.
  Reviewer then traced the StrictMode double-invoke through BOTH guards and
  confirmed one network call, one state update, badge rendered; that mintingRef
  cannot latch because every throw routes through its finally; and that the
  visibility gate and the countdown wiring were byte-untouched by both fixes.
  The plan's Task 2 listing now carries an amendment naming both guards, so the
  next reader does not copy the version without them.
Task 3: complete (commits 4e5b576..6dc1b96, third review clean)
  ONE IMPORTANT, then a second one created by its fix -- the same shape as
  Task 2, and worth naming as a pattern: a guard added to stop something
  happening too often is one line away from stopping it happening at all, and
  vice versa.
  1. IMPORTANT: `redeem` latched lastToken unconditionally, including when the
     call THREW. A dropped connection is exactly the case where the check-in did
     not happen and must be retried, and instead the screen swallowed every
     further attempt at that badge for its whole lifetime -- through the manual
     form too, since it calls the same function. The submit button cleared and
     nothing happened; the only way out was leaving /p/scan and returning.
  2. IMPORTANT, from that fix: clearing the guard on a throw put the retry back
     in the hands of the 200ms decode loop. A badge left in frame during a
     sustained outage was resubmitted FIVE TIMES A SECOND, with no backoff,
     hitting the backend hardest exactly while it was already failing.
     Fixed with a 3s cooldown held in a ref, cancelled when a new attempt
     starts (so a cooldown scheduled for badge A cannot clear badge B's guard)
     and cleared by the camera effect's cleanup. unknown/used/expired still
     latch permanently -- repeating them returns the same answer.
  Also fixed on the way: an interval could be created after unmount, because
  `cancelled` was checked before `await video.play()` and not after; and the
  jsQR decode was unguarded against a throw inside a timer callback.
  Reviewer confirmed independently that redeemCheckinToken throws ONLY on a
  transport/RPC failure -- the four status values all resolve -- which is what
  makes "cooldown on throw, latch on status" the right split.
  Two Minor carried to the final review: a redeem() still in flight at unmount
  can create a cooldown timer that cleanup can no longer reach (inert -- no
  camera, no DOM, no observed state); and src/components/Placeholder.jsx is now
  dead repo-wide, since /p/scan was the last route using the screen() helper.
  The helper and its import are gone; the component file is still there.
Task 4: complete (commits 98a6f94..50df01d, re-review clean)
  ONE IMPORTANT, plan-mandated and mine: the patch's own header states that
  inserting a message can never fail because of a notification, but only
  notify_user() carried an exception handler. The four TRIGGER functions run
  their own lookups first -- threads, profiles -- and anything raised there
  propagates and ABORTS the INSERT or UPDATE that fired it. A member's message
  would have been lost because a notification could not be built, which is the
  exact outcome the comment forbids. Each trigger function now has its own
  handler in notify_user's shape.
  Reviewer verified against schema.sql that every column each trigger touches
  exists; that all five functions carry `security definer set search_path = ''`
  with every relation qualified (the Task 1 hole, not reintroduced); that
  messages_insert's RLS forces sender_id = auth.uid(), which is what makes the
  "other party" CASE always correct; that both notification URLs are real routes
  in routes/index.jsx; and that app_config's revoke genuinely counters patch
  006's default privileges rather than trusting RLS alone.
  Three Minor carried to the final review: notify_on_workout_plan fires on ANY
  insert, and workout_plans_write permits a member to insert their own plan, so
  a member using the builder push-notifies themselves about their own action
  (nutrition_plans_write_pro has the is_professional() guard that
  workout_plans_write lacks -- the two plan tables are inconsistent, and that
  predates this branch); notify_on_message queries threads twice to derive a URL
  it already had; and to_char(starts_at, 'Dy DD Mon ...') renders day and month
  names per the database's lc_time, which is not guaranteed to be English.
Task 5: complete (commit 0957798, review clean, approved)
  Reviewer verified the three things that fail SILENTLY if wrong: the auth check
  runs before any work and compares against Deno.env, so a missing NOTIFY_SECRET
  cannot make it pass (undefined never equals a header string); the body field
  names match exactly what notify_user() posts and the selected columns match
  push_subscriptions in schema.sql -- a mismatch there is a notification that is
  simply never delivered, with nothing in any log; and the dead-subscription
  pruning indexes results against the same array in the same order, so it cannot
  delete a live device's row.
  ONE IMPORTANT, and it was in the REPORT rather than the code: the implementer
  claimed ESLint "correctly ignores supabase/functions". It does not -- the file
  escapes linting only because no `files` glob matches `.ts`. The brief had
  asked for exactly that distinction and it was conflated anyway. Made true
  rather than left incidental: eslint.config.js now names the directory in
  globalIgnores, so a future config that does match .ts fails loudly instead of
  quietly pulling in a Deno file this project never builds.
  One Minor carried: `await request.json()` is unguarded, so a malformed body
  becomes an uncaught 500. The only caller is notify_user(), which builds the
  JSON itself and ignores the response.
Task 6: complete (commit c02c806, review clean, approved)
  One disclosed deviation from the plan's code, and the reviewer judged it the
  right call: pushSubscription.js imports data/push.js DYNAMICALLY inside
  enablePush/disablePush rather than at the top. The static version pulls in
  lib/supabase.js, which throws at module evaluation under plain `node` because
  import.meta.env does not exist there -- so the plan's own self-check step,
  `node src/features/profile/pushSubscription.selfcheck.js`, could not run as
  written. The dynamic import leaves the module with zero top-level imports,
  which is exactly what makes the self-check runnable, and changes nothing the
  browser sees beyond one more tiny chunk.
  Reviewer traced the four invariants that fail silently if wrong: the permission
  request is reached from the switch's change event with NO await in between
  (iOS refuses a request that is not the direct result of a gesture, and refuses
  it silently); disablePush deletes the row BEFORE unsubscribing locally, so a
  device cannot linger in the table; the sign-out cleanup is wrapped so it can
  never block the sign-out; and the push handler still shows a notification when
  the payload will not parse, because Chrome otherwise substitutes its own "this
  site was updated in the background" notice. Also confirmed onConflict targets
  the real unique column, and that no import cycle reaches AuthProvider.
  One Minor carried: if savePushSubscription throws after the browser-level
  subscribe() succeeded, the switch shows Off while the device holds a live
  subscription. Self-healing -- a retry reuses the existing subscription and
  only re-attempts the save.
Task 7: complete (commits 7875724..ccb374a plus the expired-step fix, re-review clean)
  ONE CRITICAL and seven Important, all in the checklist rather than in code --
  and that is the point of the task: a verification document that describes the
  plan instead of the shipped screens sends the person holding the phone hunting
  for behaviour that does not exist.
  CRITICAL: the push section never stated its prerequisites. notify_user()
  SILENTLY RETURNS when app_config is unconfigured -- deliberately, so badge and
  scanner work without the Edge Function -- so a tester following it would have
  got no notifications, no error and no clue why. It now opens with the two
  patches, the deploy command, the secret names and the app_config insert, and
  says they are Davide's.
  The rest were claims the code contradicts: the badge does NOT survive a
  refresh (every mount mints a new token); the "expired" answer cannot be
  reached by reusing a scanned badge, because redeem_checkin_token checks
  used_at BEFORE expires_at, so a used-and-expired token always answers `used`;
  "already used" needed /p/scan reloaded between the two scans, because
  ScannerScreen's own lastToken guard swallows a same-session rescan; section 4
  still called both new routes placeholders; section 0 still said eight
  self-checks while CLAUDE.md, edited in the same commit, said nine; and nothing
  exercised the scanner's `unknown` answer or the three-second retry cooldown.
  CLAUDE.md's database section still said patches 001-007; it now says 001-010
  and names 009 and 010 as what this phase depends on.
  The re-review then caught that the rewritten expired step, though honest, asked
  the tester to win a sub-second race between unlocking a phone and a re-mint.
  Replaced with the deterministic path the document already uses elsewhere: read
  an expired, never-scanned token out of checkin_tokens and type it into the
  manual-entry field.

ALL SEVEN TASKS COMPLETE. Next: whole-branch review.

## Phase 4B whole-branch review (base d6d4c08, 22 commits at review time)
ONE CRITICAL, five Important. The Critical is the fifth phase running where the
whole-branch review found something no single task owned -- and this one no task
COULD have owned, because it lives in the seam between this branch's new
function and a patch written two phases ago.

CRITICAL, security: notify_user() was a PUBLIC RPC. patches/006 grants execute
  on all routines in `public` to anon and authenticated, and sets default
  privileges that do the same for routines created later; Postgres also grants
  EXECUTE to PUBLIC by default. A non-trigger function in the exposed schema
  with EXECUTE *is* a PostgREST endpoint. So POST /rest/v1/rpc/notify_user with
  the publishable key from the JS bundle sent a real Web Push to any user id,
  with an attacker-chosen title, body and TAP URL -- and sw.js passed that URL
  straight to clients.openWindow, which is not scope-restricted. A notification
  carrying TrainHub's own icon could open anyone's page. This is verbatim the
  forgery the spec's Decision 4 chose the database-raised design to prevent; the
  plan assumed the function unreachable ("nothing in src/ calls these") instead
  of making it so.
  Fixed at both layers: `revoke execute ... from public, anon, authenticated`
  with a PASS row asserting it for BOTH app roles, and a same-origin clamp in
  the service worker. service_role keeps its grant deliberately -- that key
  never reaches a browser -- and the comment now says so.
  Re-review confirmed the two claims this rests on: the four trigger functions
  need no revoke (PostgREST excludes returns-trigger from its RPC cache, and
  plpgsql refuses the call outside a trigger with 0A000), and the revoke does
  not break them, because inside a security definer function every later
  privilege check uses the OWNER's id, whose entry a revoke naming other
  grantees never touches.
IMPORTANT 1: the branch silently broke verify.sql. Its five security and grant
  rows hard-code '16' tables; this branch adds two, so every one of them read
  FAIL -- while the spec, CLAUDE.md and the device checklist all still claimed
  they pass. The cost is not cosmetic: the next reader sees nine FAILs where
  four were documented and learns that FAIL is normal, which is how the only
  automated check the database has stops working. Bumped to 18/18/17/17/17, with
  the comment block explaining why 17 and not 18 on the last three (app_config
  is deliberately policy-less and grant-less, so its absence IS the assertion).
IMPORTANT 2: redeem_checkin_token was hardened in Task 1 and its first statement
  called is_professional(), which was not. A hardened function whose gate is
  unhardened is hardened on paper. patches/011 rewrites is_professional(),
  owns_member() and handle_new_user() with an empty search path and qualified
  relations, and policies.sql and schema.sql carry the same fix so a fresh
  install is not born with the hole -- patch 008's precedent.
IMPORTANT 3: BadgeScreen's failure path was a dead end. The mint effect runs
  once, so on failure nothing retried, nothing listened for `online`, and the
  copy promised a recovery that could not happen. Now the app's standard
  ErrorState with Retry, plus an online listener that heals it.
IMPORTANT 4: the countdown subtracted the DEVICE clock from a SERVER timestamp.
  A phone more than a minute fast saw remaining <= 0 on the first tick and minted
  a row per round trip for as long as the screen stayed visible; a slow phone
  showed a comfortable countdown over a badge that died minutes ago. The device
  clock is now out of the calculation entirely: the lifetime is expires_at minus
  created_at, both server-side, counted down locally from receipt.
IMPORTANT 5: disablePush deleted the row and THEN unsubscribed, so an offline
  sign-out left the device subscribed to the departed user's notifications --
  the exact failure that call was added to prevent -- and blocked the next user,
  whose upsert would conflict on an endpoint row that push_subscriptions_all
  makes neither visible nor updatable to them. The unsubscribe is now in a
  finally, with the import inside the try so a rejected chunk still reaches it.
Then the re-review of the fix wave found ONE MORE, and it is the kind this
  project keeps producing: the three new PASS rows in patches/011, and the one
  patches/009 has carried since Task 1, asserted `'search_path=' = any(proconfig)`.
  Postgres stores that GUC quoted -- `search_path=""` -- so a CORRECTLY applied
  patch would have reported FAIL to the only person able to apply it. Now an
  array overlap against both spellings, which is right either way.
Also fixed: Placeholder.jsx deleted (dead since /p/scan was the last route using
  the screen() helper); the notification tap now navigates an open window to the
  target instead of opening a second one; and the device checklist gained the
  net._http_response query, which is where a notification that never arrived
  explains itself -- pg_net is fire-and-forget, so a 403 from a secret mismatch
  leaves no trace anywhere else.

Verdict after fixes: READY TO MERGE. lint 0, build ok, all 9 self-checks OK.

EVERYTHING BELOW NEEDS A HUMAN, in this order:
  1. Run patches/009-checkin-tokens.sql, 010-push-notifications.sql and
     011-harden-definer-functions.sql. Every row of each must read PASS.
  2. Insert the two app_config rows by hand -- notify_function_url and
     notify_secret. The patches leave the places empty on purpose so the values
     never enter the repository. Until they exist notify_user returns silently
     and nothing else is affected, which is deliberate: badge and scanner work
     on a database where the Edge Function was never deployed.
  3. Generate the VAPID pair, put the public key in .env.local as
     VITE_VAPID_PUBLIC_KEY, and set the four secrets on the function.
  4. npx supabase login / link, then deploy the notify function with
     --no-verify-jwt. This is the step that can block; if it does, badge and
     scanner are unaffected.
  5. Re-run verify.sql. Five rows PASS at their NEW counts, four seed rows FAIL
     by design.
  6. The device walk in docs/superpowers/2026-07-30-device-verification.md,
     section 9 -- including push on BOTH phones, with the iPhone installed from
     Safari on iOS 16.4+.
Open Minor, deferred with reasons: a redeem() in flight at unmount can leave a
  cooldown timer nothing clears (inert); the Edge Function's request.json() is
  unguarded, reachable only by a caller who already knows the secret;
  notify_on_message queries threads twice; to_char renders day and month names
  per the database's lc_time, which is not guaranteed English; a
  savePushSubscription that throws after subscribe() succeeded shows the switch
  Off over a live subscription (self-healing on retry); workout_plans_write
  lacks the is_professional() guard its nutrition sibling has, which predates
  this branch; and the badge's local deadline includes the round trip, so it
  trails the server's true expiry by a few hundred milliseconds.

Push chain verified end to end from the SQL editor, 2026-07-31, before any
device: notify_user -> pg_net -> Edge Function answers 200.
One real incident on the way, worth keeping: the app_config row held the
LITERAL `https://<project-ref>.supabase.co/...`, pasted from the handoff without
substituting. net.http_post refuses a malformed host, notify_user's own
exception handler turns that into a `raise warning`, and the SQL editor does not
surface warnings -- so the symptom was NOTHING: no queued request, no response
row, no error anywhere. The failure-isolation the reviews asked for is right,
and this is its cost: the only way back is reading the config value rather than
checking the row exists. Both the read-back and a device-free smoke test are now
steps in the checklist's push prerequisites.

Device reality, 2026-07-31: only an iPhone is available, so the spec's decision 6
("Android and iPhone") is amended to iPhone only. iOS is the stricter platform --
it needs 16.4+, installation from Safari specifically, and refuses a permission
request that is not the direct result of a gesture -- so passing there is the
stronger claim; Android is recorded as supported and untested, which is what the
report will say. Web Push is one standard and the code does not branch on
platform.
Consequence for the scan check: it needs two cameras only if both ends are
phones. With one device, the badge goes on the iPhone and /p/scan runs in desktop
Chrome against the webcam -- which is exactly why BarcodeDetector was dropped for
jsqr in decision 2, since the native decoder does not exist in Chrome on Windows.
Also corrected in the checklist: it claimed the notifications switch is "on by
default". It is not -- NotificationSwitch reads currentSubscription(), so a fresh
install starts off.

PUSH VERIFIED END TO END ON IPHONE, 2026-07-31. notify_user -> pg_net -> Edge
Function -> Apple -> the device. Patches 009, 010 and 011 are applied, the
Edge Function is deployed, app_config carries both rows, and a push_subscriptions
row exists with a web.push.apple.com endpoint.
Two things were fixed on the way there, both diagnostic rather than functional:
  - the app_config URL held the literal <project-ref> placeholder (see above);
  - the Edge Function reported `sent: results.length`, counting every SETTLED
    result, so a batch the push service refused outright still read as success --
    and the caller is a trigger that ignores the response, so nothing anywhere
    contradicted it. Now it counts fulfilled sends, returns a failure count, and
    logs each rejection with its status code and body (commit f01da9f). A VAPID
    public key that does not match the one the device subscribed with is a 403
    and appears nowhere else.

GAP FOUND AND FIXED, 2026-08-01: the spec's manual-entry field
(ScannerScreen.jsx, "Enter a code by hand") was designed only for the
scanner-side camera failing during a demo -- there was nothing on the
member's side to feed it if the QR itself couldn't be read (cracked screen,
glare, dead desk camera). BadgeScreen now shows the same token as plain
monospace text beneath the QR ("QR won't scan? Read this code to the front
desk"), selectable, same string the QR encodes, no new expiry or entropy.
Spec amended in place under `/m/profile/badge`. Lint 0, build clean.

DEVICE WALK, 2026-08-01 -- badge (Daniel's iPhone) and scan (Andrea's phone
against Daniel's badge) both passed every check in section 9 in full: QR,
countdown, rotation, no minting while locked, ErrorState with Retry offline
and self-heal on reconnect; valid / already used / expired / unknown / camera
denied / retry cooldown on the scanner side.

Push, on iPhone, surfaced two real gaps and one non-issue:

1. GAP, FIXED: a professional-created appointment (NewAppointmentSheet.jsx,
   INSERTs straight to 'confirmed' -- no pending step, the professional owns
   the diary) never notified the member. patches/010's trigger was
   `after update of status`, and that row's status is never UPDATEd -- only a
   member's own request (INSERT 'pending', later UPDATEd by the professional)
   ever fired it. Fixed by moving the trigger to
   `after insert or update of status` and guarding on the row's status
   ('pending' notifies nobody) rather than comparing to `old`, which doesn't
   exist on INSERT. Source fixed in patches/010-push-notifications.sql;
   patches/012-appointment-insert-notifies.sql carries the same fix onto
   Davide's already-migrated database. NOT YET APPLIED -- needs running in the
   SQL editor and re-testing: coach books directly (not via a member request)
   -> member should now get "Appointment confirmed".
2. NOT A BUG: after the plan report, iOS Settings -> TrainHub -> Notifications
   still shows "Allow Notifications" on after the in-app switch is turned off.
   Expected: `disablePush()` deletes the row and calls
   `subscription.unsubscribe()`, which revokes the *subscription* (no endpoint
   left to send to), but nothing in the Push API can revoke the OS-level
   permission grant -- only the user can, in Settings. The in-app switch
   correctly stops delivery; the OS toggle is a separate, one-way grant.
3. CLARIFIED, no code change: "what notification arrives when a plan is
   assigned" -- title is "New workout plan" or "New nutrition plan" depending
   on which table the INSERT landed in, body is the plan's name (or a
   fallback), tap opens /m/workout or /m/nutrition respectively. Two plan
   kinds, two of the four triggers, by design (decision 3 in the spec).

Sign-out correctly stops push on that device (row deleted at sign-out,
confirmed by test). Message and appointment-status (member-initiated) push
both confirmed arriving and opening the right screen.

GAP FOUND AND FIXED, 2026-08-01, badge code length: the QR's text fallback
(above) used the full UUID token -- 36 characters, not something read aloud at
a front desk. Tokens are now generated by `generateBadgeCode()`
(src/data/checkin.js): 8 characters from a 32-symbol Crockford-style alphabet
(no 0/O/1/I/L), 40 bits -- ample given `redeem_checkin_token` only accepts an
authenticated professional, so the threat model is an insider guessing within
sixty seconds, not an open brute force. Displayed grouped as "XXXX XXXX"
(display only; QR and stored token stay the ungrouped 8 characters). The
scanner's manual field uppercases and strips whitespace before comparing.
`checkin_tokens.token` is `text`, no format constraint -- no SQL change
needed. Spec amended in place. Lint 0, build clean.

patches/012 applied, professional-books-directly case re-tested and PASSES.

PHASE 4B MERGED into main via pull request #3 (merge commit fac023d,
2026-08-03). Branch phase-4b-badge-scanner-and-push is on origin, kept per
Davide's standing instruction to not delete branches. Every route in
src/routes/index.jsx now renders real content; Placeholder.jsx deleted.

All of the original schedule's phases 0-4 (design spec section 7) are done,
roughly three weeks ahead of the 20-24 Aug date phase 4 was scheduled for.
Next per the schedule is phase 5, hardening + report.

# Phase 5 — Hardening (started)

Cross-checked docs/superpowers/2026-07-30-device-verification.md against what
had an actual on-device confirmation in this ledger, rather than assume a
generic "walked the app" pass covered every itemised check. Sections 0, 1, 2
(minus a Lighthouse re-run and report screenshots, still pending), 5, 6, and 9
already had one. Sections 3, 4, 7 and 8 did not -- Davide ran them 2026-08-03:

Section 3 (chat) -- confirmed working except: the header bell badge does NOT
update within its 60s poll; Daniel had to reload manually. AppLayout.jsx:36 has
`refetchInterval: 60_000` on `queryKeys.unreadCount`, and the query itself
(fetchUnreadCount, src/data/chat.js:118) looks correct -- counts messages where
`sender_id != you and read_at is null`, which is right. NOT YET ROOT-CAUSED;
candidates not yet checked: AppLayout remounting on navigation (resetting the
interval's clock before it fires), or the interval pausing on
`document.visibilityState` in a way that doesn't match how Davide was actually
holding the phone. Left open, deliberately not touched this session.

Section 4 (rest of the member's app) -- everything confirmed correct: meal
detail, specialty filters (untestable with only one seeded professional, but
present and not broken), the month-boundary calendar jump, offline booking
replay on reconnect, subscription renewal date.

Section 7 (Phase 2, workout) -- confirmed: timer survives a live-session
reload; log-set double-tap guard. TWO REAL DEFECTS found, not yet fixed:
  - the timer does NOT reset navigating from one live session to another --
    the checklist's expected behaviour (queue-item: "resets to the new
    session's clock") does not hold; the old session's elapsed time carries
    over.
  - a session completes and AWARDS A REWARD even when zero exercises were
    logged. The checklist expected finishing offline with no data to refuse
    to render a summary (and it does, correctly) but finishing ONLINE with no
    sets logged should arguably be the same refusal, or at least not mint a
    reward for nothing done.
Davide's own assessment, unprompted: this whole section was built against
wireframes that were not well thought through, and needs a real refactor of
the live workout session's functionality and logic -- not just these two
bugs patched in place. He is writing a prompt describing how live workout
should actually work and wants to brainstorm the redesign together before any
code changes, design included.

Section 8 (Phase 1 core) -- confirmed correct in full: home screen content,
greeting, today's appointments, week strip, bell.

(SUPERSEDED 2026-08-05 by the Phase 5A section at the end of this file -- the
prompt arrived, the brainstorm happened, the spec is written. Read that one.)

Hardening is paused on purpose: Davide wants to redesign the live
workout session (Phase 2's weakest part, built against under-specified
wireframes) BEFORE finishing the hardening/report pass, since a redesign would
invalidate device-walk results and report screenshots taken against the old
flow. He is about to share a prompt describing the intended live-workout
behaviour. Use superpowers:brainstorming for that discussion -- he explicitly
asked to design it together, design included, not to receive an
implementation straight away.

Still open and NOT yet fixed, independent of the workout redesign:
  - the header bell badge's live-update gap (section 3 above) -- small,
    unrelated to workout, root cause not yet found.
  - the bell has never been clickable at all (TopHeader.jsx: the IconButton
    wrapping NotificationsIcon carries no onClick and no Link, unlike the
    profile avatar next to it). Noticed 2026-08-03, while looking at the badge
    bug above -- not a regression, it was built this way from the start.
    Davide wants tapping it to open an actual notifications view, the way
    every other mobile app's bell works. No screen for that exists yet
    (checkins have no history view either, by the same "not built" reasoning
    as the Phase 4B spec's out-of-scope list) -- this is new scope, not a bug
    fix, and needs its own design pass: a dropdown, a screen, what it lists
    (unread threads only, or the same three events push notifies on).
    Deliberately not scoped further here -- queued behind the workout redesign.
  - Lighthouse re-run + report screenshots (Lighthouse panel, DevTools
    Application Manifest/Service Workers) for chapter 5 -- blocked on nothing,
    just not done yet.
Once the workout redesign is scoped and built, the remaining hardening item is
re-verifying section 7 against the NEW flow rather than the old checklist
wording, plus everything above.


# Phase 5A -- The workout half, rebuilt (design done, not yet planned)

Branch `phase-5a-workout-redesign`, cut from `main` at 86e8c3a on 2026-08-05.
Hardening and the report stay paused behind this, for the reason recorded in
the section above: a redesign invalidates device-walk results and report
screenshots taken against the old flow.

Davide wrote `doc/live_train_session.md` -- his own brainstorm of how the
member's workout half should work -- and asked to be grilled on it rather than
handed an implementation. Four rounds of questions later, nineteen decisions
are settled and written up in

    docs/superpowers/specs/2026-08-05-trainhub-workout-redesign-design.md

which is the source of truth for this phase. Do not re-derive it from the
brainstorm; the brainstorm contradicts itself in two places (weight editing,
and "stop") and the spec records how each contradiction was resolved and why.

The one-line shape of it: a session's state stops being a column and becomes
DERIVED from `workout_runs` rows inside the current ISO week. Every press of
play opens a run; every `set_logs` row points at one. That single change is
what makes the plan weekly, the counting correct, the points honest, the clock
right, and abandoning safe without deleting anything.

Nine defects are named in the spec with file and line. Three Davide confirmed
by hand on 2026-08-03; SIX came out of reading the code while designing, and
are latent only because nothing in the app repeats yet:

  - `loggedCount` is a LIFETIME count (`workouts.js:17`). Week 2 reads `6/3`
    and nothing ever completes again.
  - the reward code is `workout:${sessionId}` against `unique (member_id,
    code)` with `ignoreDuplicates: true` (`rewards.js:28`). The second
    completion of a session awards NOTHING, silently. Becomes `workout:${runId}`.
  - an empty plan hides the coach's plan, because `fetchActivePlan` takes the
    newest by `created_at`. This is live on the PROFESSIONAL's side today:
    create a plan, stop before the first session, and the member's screen
    reads "This plan has no sessions". Closed by deferring the write until
    plan AND first session both exist -- which fixes the coach's side too.
  - the member cannot create a plan at all (`WorkoutBuilderScreen` only adds a
    session to an existing plan).
  - end-of-session notes for the coach do not exist, though
    `doc/live_train_session.md:63` believes they do.
  - `expires_on` is printed by the plan banner although the brainstorm's own
    section 21 says validity is deliberately not tracked.

Deliberately NOT in this phase, and each already has a reason on file: the
notification bell (both its stale badge and its missing tap target), a history
screen for archived plans, a member-side progress screen, real exercise
imagery, dropping `workout_sessions.status` or `workout_plans.expires_on` from
the schema, and reordering sessions or exercises.

Two things worth knowing before touching the implementation, both of which the
spec explains at length and both of which are the kind of thing that costs a
day if missed:

  1. `startRun`, `logSet` and `endRun` MUST share one `scope` in
     `src/data/mutations.js`. `set_logs.run_id` is a foreign key and
     `resumePausedMutations` replays in parallel without a scope, so a set can
     land before the run it references. `logSet` carries no scope today.
  2. `timer.js` and its self-check do NOT change. Its three keys map one to one
     onto three new columns on `workout_runs`; only where the state is read
     from changes.

The plan is `docs/superpowers/plans/2026-08-05-phase-5a-workout-redesign.md`
(95b9a2c), eleven tasks. Tasks 1 to 3 are done:

  - b4ad1d8  task 1  `week.js` + self-check. `mondayOf`, `runStatusOf`.
  - d733f6d  task 2  `pointsForRun`, `countsByExercise`, the `partial` status,
                     and `planProgress` counting partials. Self-checks extended.
  - af91589  task 3  `supabase/patches/013-workout-runs.sql` + `verify.sql`
                     counts moved 18->19 and 17->18.

Three cases were added during task 1 that the plan had not foreseen, and the
middle one changed the implementation: `mondayOf` accepts a full ISO instant,
`runStatusOf` compares on the LOCAL day rather than the raw ISO string (a run
started 23:30 on Sunday carries a UTC timestamp dated Monday and would
otherwise be filed under the week that had not begun yet), and it sorts by
`Date.parse` rather than lexically.

patches/013 applied 2026-08-06, all eight rows PASS. `verify.sql` re-run: the
five schema/security rows PASS at 19/19/18/18/18. Seven seed rows read FAIL --
the four documented ones (005-demo-clients) plus `messages`, `rewards` and
`checkins`, which have simply grown from the Phase 4B device walks. Not a
defect.

STILL OWED from that handoff: the anonymous-client RLS probe on `workout_runs`.
`verify.sql` runs as the dashboard's privileged role and bypasses RLS, so it
proves the policies exist and not that they are right. Not treated as blocking
because both policies are verbatim copies of `set_logs`', already in service --
but it is owed before the phase closes.

Tasks 4 to 11 are done, all eleven committed:

  - 2372431  task 4   `src/data/runs.js`, run-scoped counting, run writes
                      registered, keys added.
  - 34b9685  task 5   `PlanForm` extracted, `CreatePlanFlow` shared by both
                      roles, `WorkoutBuilderScreen` deleted.
  - ed80fa0  task 6   plan screen: weekly states, overflow menu, edit mode,
                      empty-state fork. Plus `AddSessionScreen` and patch 014.
  - 0e9fe08  task 7   session screen: weekly state, guarded play, edit mode,
                      `AddExerciseScreen`, `OpenRunSheet`.
  - 2ec53ac  task 8   live session driven by the run; `EndRunSheet`,
                      `CongratsDialog`; reward code is now `workout:${runId}`.
  - 0f8ddb9  task 9   exercise screen grew the logging half; `RestTimer`;
                      `LogSetSheet` deleted.
  - 04371b0  task 10  `LiveSessionBar` mini-player mounted in `AppLayout`.
  - b3d65c4  task 11  summary keyed on the run, member's note, dead code out.

FIVE THINGS THE PLAN GOT WRONG, all found while building and all corrected:

  1. `week.js` was to live in `src/features/workout/`. Having `data/workouts.js`
     import it inverted the layering CLAUDE.md fixes (`features/` calls `data/`).
     It is pure date logic like `format.js`, so it moved to `src/lib/week.js`.
     The documented self-check list is now TEN, and CLAUDE.md says so.
  2. The plan computed "the previous Monday" through `Date.now() - 7*86_400_000`
     and `toISOString()`. Both wrong: millisecond arithmetic breaks across a DST
     boundary (one day a year is 23 hours, another 25) and `toISOString()`
     converts to UTC, reintroducing the very off-by-one-day `week.js` exists to
     prevent. Replaced by `daysBefore()`, with the 2026 DST Sundays pinned in
     the self-check.
  3. `CreatePlanFlow` was to chain `createPlan` then `createSession` through
     `onSuccess`. Per-call callbacks ARE NOT PERSISTED: offline, the plan queues,
     and if the member closes the app before reconnecting the replay creates the
     plan with no callback left to create its session -- an empty plan, which is
     defect 8 walking back in through the side door. Both writes now fire
     together, ordered by a shared `planWrite` scope.
  4. `patches/013` shipped without a `pct` column, though the spec requires the
     card to read "Stopped at 60%". Deriving it would mean loading every run's
     logs to draw four cards. Fixed by `patches/014` plus the source file, the
     008/011/012 convention.
  5. Deleting `WorkoutBuilderScreen` also deleted the only way to ADD a session
     to an existing plan, not just to create one. Reborn as `AddSessionScreen`,
     with its route placed BEFORE `:sessionId` or "new" parses as an id.

Two claims were also walked back for being false rather than merely imprecise.
The self-check asserted that `pct` and the points can never disagree; they can
differ by one, because a whole percentage is a lossy carrier (one set of six is
16%, while the award is floor(30/6)=5 rather than floor(30*0.16)=4). The
assertion now pins what is actually true -- no points without progress, no full
award without a full session, neither moving while the other stands still --
and the comment in `patches/014` was corrected to match.

SCOPE CHANGE, Davide's call 2026-08-06: the professional's side becomes its own
spec after the member's side is finished. Task 11's third step -- surfacing the
member's note in `ClientProgressScreen` -- is therefore OUT of this phase.
CONSEQUENCE, recorded rather than hidden: `workout_runs.note` is written and
never read until that spec lands. `ClientWorkoutScreen` was still touched here,
but only as far as the shared extraction forced (it held `NewPlanForm`, and it
read the dead `status` column).

WHOLE-BRANCH REVIEW, 2026-08-06. Held as CLAUDE.md's working agreement
prescribes, and as in every phase before it, it found a CRITICAL that no single
task owned:

  - 6973df1  CRITICAL. Starting a workout never worked. `beginRun` fired the
             mutation and navigated in the same handler; the live screen
             redirects away when it finds no open run for its session, and the
             cache still held null. Guaranteed offline, and a race the
             navigation usually won online. Each task was correct alone -- task
             7 wrote the navigation, task 8 the guard, task 4 the cache.
             Fixed by registering `onMutate` cache writes for `startRun` and
             `endRun` in `src/data/mutations.js`, not at the call sites, so a
             screen cannot forget. `endRun`'s also seeds the summary, which
             reads a key nothing had ever populated -- finishing a workout
             offline landed on an empty screen.
  - df2a584  Logging a set into a run whose logs had never been fetched was a
             silent no-op, because the optimistic write bailed when the cache
             entry was undefined. Worse, the double-tap guard only clears when
             the count changes, so the form then locked against every further
             set. Seeded instead of skipped.
  - df2a584  A run stopped at 40% was titled "Completed X" in the rewards list.
  - 51ccf89  The exercise screen carried its own clock while the mini-player
             showed the same one below it. Deleted the local one; the
             mini-player is the general answer and already covers every screen.
  - c283406  The spec was reconciled with what was actually built: `week.js`'s
             new home, `daysBefore`, patches/014, the run-keyed summary route,
             the three screens the spec had not named, and the walked-back claim
             about points and `pct` agreeing exactly.

RESUME HERE. All eleven tasks are built and reviewed; `npm run lint` and
`npm run build` pass and all ten self-checks are green. NOTHING has been
exercised in a browser -- lint and build cannot catch a wrong query or a broken
flow, so treat every screen as unverified.

BLOCKING, first thing: apply `supabase/patches/014-workout-run-pct.sql`. From
commit 2ec53ac every run read selects `pct`, so until 014 lands EVERY run query
answers "column workout_runs.pct does not exist" and the whole workout half is
dark. 013 alone is not enough any more.

patches/014 applied 2026-08-06, all rows true. Both database handoffs are now
closed.

The anonymous-client RLS probe is DONE and no longer a manual handoff: it is
`supabase/probe-rls.mjs`, run with `node supabase/probe-rls.mjs`. Every table
plus `redeem_checkin_token` reads PASS, `workout_runs` included. It carries a
connectivity control on purpose -- a wrong URL, a dead project or a rejected key
all make every table answer "empty", which looks identical to perfect security.
`app_config` is grant-less by design and must refuse with 42501, so that refusal
is what makes the empties mean anything.

One assumption was wrong on the first run and is worth remembering: NOTHING in
this schema is anonymously readable, not even `exercises` or `profiles`. Both
gate on `auth.uid() is not null`, which is deliberate and load-bearing -- the
comment above `profiles_select_professionals` explains why.

STILL OWED, and the only thing left: the ten-step device walk in the spec's
Acceptance section, on a real phone installed from Safari. Nothing in this phase
has been exercised in a browser.

HUMAN HANDOFF, blocking everything: `supabase/patches/013-workout-runs.sql`
does not exist yet -- it is written as part of task 1 -- and once written must
be applied BY DAVIDE in the Supabase SQL editor. No agent holds credentials.
Nothing in this phase functions before it lands. `verify.sql` also moves from
18 tables to 19 in the same patch, and the new policies must be probed from an
anonymous client, because `verify.sql` cannot catch a policy whose `using`
clause never mentions `auth.uid()` -- Phase 0 shipped exactly one of those.


## Rest timer audio -- two wrong turns, worth not repeating

Davide reported the rest timer silent on iPhone twice. Both causes were real and
neither was obvious.

1. `beep()` built its `AudioContext` inside the `setInterval` callback, ninety
   seconds after the tap. A context created outside a user gesture is born
   `suspended` on iOS and under Chrome's autoplay policy and never sounds. The
   docstring above it claimed the opposite of what the code did -- a comment
   describing the intent instead of the behaviour.
2. Fixing that was not enough. Safari on iOS routes Web Audio through the
   AMBIENT audio category, which the hardware ring/silent switch mutes. No web
   API overrides it. Most phones in a gym have that switch on.

The answer is an `<audio>` element holding an inline WAV data URI
(`src/features/workout/beep.js`), unlocked by playing and immediately rewinding
it inside the tap that starts the rest. The media path an `<audio>` element uses
ignores the silent switch.

Also walked back: an earlier claim that scheduling on the Web Audio clock
survives backgrounding. True on desktop Chrome, FALSE on iOS, where Safari
suspends the context and `currentTime` stops. It was written from the API's
documented behaviour rather than from a device, and stated more confidently than
it had earned.

3. Once it sounded through the silent switch, it seized the phone's audio
   session: starting a rest cut off whatever music was playing. Two separate
   causes again. The unlock itself was audible for a few milliseconds, which is
   enough to take the session -- fixed by unlocking with `muted = true`, the
   only lever available since `volume` is read-only on iOS. And the chime played
   in the default category, which stops other audio rather than ducking it --
   fixed with `navigator.audioSession.type = 'transient'` (WebKit, Safari 16.4),
   the category the system timer uses. `transient-solo` pauses other audio and
   `playback` takes the session over; neither is what a rest timer wants.

What is honestly true, and belongs in the report's PWA-constraints chapter:

    <audio>, unlocked by a gesture   works, ignores the iOS silent switch
    navigator.audioSession           WebKit only; 'transient' ducks other audio
    Web Audio                        muted by that switch on iOS
    Vibration API                    absent in Safari on iOS
    scheduled local notifications    no web API at all
    setInterval in the background    throttled everywhere, frozen on iOS

The finish is therefore also announced through `aria-live` and stated in text.
Sound is an enhancement here, never the only carrier.


# PHASE 5A MERGED into main via pull request #4

Merge commit 53f732d, 2026-08-06. 30 commits, 46 files, +5939/-687. Branch
`phase-5a-workout-redesign` kept, as every earlier one has been.

Verified on main after the merge: lint, build, all ten self-checks, and
`node supabase/probe-rls.mjs`.

Two findings arrived after the whole-branch review, from Davide's second pass:

  - "See how it went" landed on the SESSION screen instead of the summary. The
    same `onMutate` cache write that makes starting a workout work offline
    clears the open run, which re-rendered the live screen in the same commit as
    the navigation -- and its `<Navigate replace>` replaced the summary. The
    fix that made the entrance work broke the exit. A `leaving` flag now stops
    the screen deciding where to send anyone once the member has committed to
    finishing.
  - Points could be farmed by reopening a completed session. Capped at ONE
    AWARD PER SESSION PER CALENDAR DAY, via `earnedOn()` in `src/lib/week.js`.

The principle behind that cap is worth keeping: RATION THE POINT, NEVER THE
WORKOUT. Starting, logging and the coach's view are all untouched -- refusing
to let someone train would throw away the data the coach actually reads, and
the points are the only thing that can be farmed. A run that paid nothing has
not spent the day, so closing empty or abandoning leaves the member free to come
back and train it properly. The comparison is on the LOCAL day: a session
started at 00:30 carries a UTC timestamp dated yesterday and would otherwise pay
twice.

RESUME HERE. Phase 5A is done and merged. Nothing is in flight.

Queued, in dependency order:

  1. The PROFESSIONAL'S side of the workout rebuild -- its own spec, Davide's
     decision. Includes surfacing `workout_runs.note`, which the member writes
     and nobody reads until then, and probably a weekly view of a client now
     that runs exist. This is the acknowledged debt of Phase 5A.
  2. The notification bell: the badge that does not refresh within its 60s poll,
     and the fact that it has never been clickable at all. Needs its own design
     pass -- dropdown or screen, and what it lists.
  3. Hardening and the report: re-run Lighthouse, capture the screenshots for
     chapter 5, write chapters 4/5/6 and the slides. Section 7 of
     `docs/superpowers/2026-07-30-device-verification.md` must be rewritten
     against the NEW workout flow rather than the old wording.

The rest-timer audio story (three causes in sequence, ending at
`navigator.audioSession.type = 'transient'`) is written up above and is direct
material for the report's chapter on PWA constraints.


# HOTFIX-SECURITY-INTEGRITY MERGED into main via pull request #5

Merge commit e887aab, 2026-09-02. 105 files, +4568/-1978. Written by Andrea,
reviewed and finished here. Branch `hotfix-security-integrity` kept.

Covers the security debt items #3 (grants/RLS) had been carrying since Phase
0: `patches/015` revokes direct `insert`/`update`/`delete` on every
user-writable table project-wide and replaces every write with an
RPC (`*_secure` naming), each `security definer set search_path = ''`. Also
makes plan/session/exercise creation atomic (one transaction instead of two
chained mutations sharing a `scope`), and replaces in-place session/exercise
editing with a versioned "replace plan" model (`replaces_plan_id`) for BOTH
roles -- deleting a session or exercise from an existing plan no longer
exists anywhere; replacing the whole plan does.

Review found two data-integrity bugs in `patches/016`'s repair of pre-existing
reward rows, both root-caused from evidence Davide read out of the Supabase
SQL editor rather than guessed at: legacy rows written before `run_id` existed
on `rewards` (code-encoded, invisible to every `run_id`-keyed join, colliding
with the final insert on `rewards_member_id_code_key`) needed a backfill; rows
whose code-encoded run pointed at a `workout_runs` row deleted before the
column existed needed deletion instead, or the backfill itself violated
`rewards_run_fk`. Fixed in commit a1fb357.

The security rewrite also silently narrowed WHO may create a workout plan:
`create_workout_plan_secure` hand-rolled a professional-only authorization
check instead of reusing the project's existing `owns_member(target)`
predicate (`patches/011`), dropping the member's own ability to create their
plan -- a dual-role requirement agreed before this PR existed, not an intended
narrowing. `patches/017` restores it by switching that one check to
`owns_member`; everything else in the function (the atomic bundle, the replay
check, the `replaces_plan_id` concurrency check) is untouched. Commits
e222e9f (the fix) and 5146f97 (a same-day fix to the patch's own self-check:
a `like` pattern kept a space that `regexp_replace` had already stripped from
the compared text, so it could never match -- the four other checks already
showed the function itself was correct).

A SECURITY REWRITE THAT TOUCHES EVERY WRITE PATH IS NOT THE PLACE TO ALSO
NARROW WHO IS ALLOWED TO WRITE. The two are separable and got conflated once
here; worth a second pair of eyes specifically for authorization-predicate
drift whenever a future patch touches a `security definer` function's `if`
guard, not just its SQL correctness.

Design doc for the restoration: `docs/superpowers/specs/2026-09-02-member-
plan-authorship-fix-design.md`.

RESUME HERE. The hotfix is merged, patches 015-017 applied. Nothing is in
flight.

Queued, in dependency order:

  1. The member-side workout-CREATION UX itself -- Davide wants a dedicated
     pass on `CreatePlanFlow.jsx`/`NewPlanScreen.jsx`'s flow and visuals,
     deliberately kept out of this hotfix. His own prompt, not started.
  2. The PROFESSIONAL'S side of the workout rebuild from Phase 5A (`workout_
     runs`-based, weekly-repeating) -- its own spec, still Davide's decision,
     still the acknowledged debt of that phase.
  3. The notification bell: still not clickable, still doesn't refresh within
     its 60s poll.
  4. Hardening and the report: `patches/015` covers the hardening half of what
     was queued after Phase 5A. Still open: re-run Lighthouse, capture
     screenshots for chapter 5, write chapters 4/5/6 and the slides, rewrite
     section 7 of `docs/superpowers/2026-07-30-device-verification.md` against
     the current workout flow.


# WORKOUT-CREATION-WIZARD MERGED into main via pull request #6

Merge commit 17d17c3, 2026-09-02. Branch `workout-creation-wizard`, off
`5a7f2fa` (right after the hotfix merge). 10 commits. Built via
`superpowers:subagent-driven-development`: 7 plan tasks, each a fresh
Sonnet 5 implementer + a Sonnet 5 task reviewer (spec + quality), then a
whole-branch review on Opus 5, one fix round, a focused re-review
(`Ready to merge: Yes`), and two further rounds of fixes from Davide's own
manual click-through. Spec: `docs/superpowers/specs/2026-09-02-workout-
creation-redesign-design.md`. Plan: `docs/superpowers/plans/2026-09-02-
workout-creation-wizard.md`.

Item 1 of the hotfix entry's queue -- the member-side workout-creation UX
Davide deferred out of that merge -- is this branch. `CreatePlanFlow.jsx`
is now a local draft-then-commit wizard (plan meta -> any number of
sessions, each add/edit/delete-able before anything is written -> one
atomic RPC call), backed by `patches/018` extending `create_workout_plan_
secure` to accept an array of sessions instead of one, looping the existing
`_insert_session_bundle` helper -- atomicity and `patches/017`'s
self-authorship check both carry over unchanged. `ClientWorkoutScreen.jsx`
lost its inline "Add a session"/"Add exercise" paths; replacing a plan via
the same wizard is now the only way to change an existing one, for both
roles. The exercise catalogue grew from 4 muscle groups (10 exercises) to
7 (22), via `patches/019`.

Verified on main after the merge: lint, build, all fourteen self-checks,
and `node supabase/probe-rls.mjs`.

Two rounds of findings, both closed before merge rather than deferred:

  - The whole-branch review (Opus 5) found the RPC/JS contract and
    `patches/017`'s authorization both carried over correctly, but caught
    four real UX gaps a task-scoped review structurally cannot see: the
    session-drafting step had no way back to the summary except discarding
    the whole draft; the summary screen showed sessions but not the plan's
    own name/goal/level/weeks, with no way to fix a typo without starting
    over; the deploy-ordering dependency on patches 018/019 existed only in
    scratch files, not anywhere durable in the repo; and a member reaching
    `/m/workout/builder` with an existing plan already (no route guard) would
    draft an entire plan only to have it rejected at the very last step by
    the optimistic-concurrency check. All fixed, re-reviewed clean.
  - Davide's own manual pass then found two more: no visible entry point at
    all for a member to replace an existing plan (the defensive fix above
    only stopped it from failing, it didn't surface a button), and the
    exercise picker's `Autocomplete` `groupBy` rendering broken/repeated
    section headers because `fetchExerciseCatalogue` ordered by `name` only
    -- MUI requires options pre-sorted by the grouping key. Also added the
    muscle-group filter (`Chip` row, same pattern as `BrowseTrainersScreen`'s
    specialty filter) that `doc/create_workout.md` had asked for and the
    plan's Task 7 never covered (it only expanded the catalogue's content).

RESUME HERE. The wizard is merged. Nothing is in flight.

Correction, found while answering Davide's question about item 1 below:
the PROFESSIONAL'S side of the Phase 5A workout rebuild was carried as open
debt in the hotfix entry above, but checking the actual code now shows PR
#5 already delivered it as a side effect of its broader scope --
`ClientProgressScreen.jsx` already uses `workoutWeekSummary` and surfaces
`run.note` (the member's note, previously "read by nobody"),
`WorkoutRunDetailScreen.jsx` (new in PR #5) is the per-run detail screen,
and `ClientWorkoutScreen.jsx` already derives session status via
`runStatusOf` against the current week rather than the old frozen column.
Closed, not queued.

Queued, in dependency order:

  1. Hardening and the report: re-run Lighthouse, capture screenshots for
     chapter 5, write chapters 4/5/6 and the slides, rewrite section 7 of
     `docs/superpowers/2026-07-30-device-verification.md` against the
     current workout flow -- now including this wizard.
  2. A DB cleanup pass before submission, Davide's own item: `create_
     workout_session_secure`/`add_session_exercise_secure` are unreachable
     from the app since this merge but still exist and are still callable
     server-side; decide whether to drop them or leave them.


# NOTIFICATION-CENTER MERGED into main via pull request #7

Merge commit 69f2e9f, 2026-09-03. Branch `notification-center`, off
`8f18025` (right after the workout-wizard merge). 19 commits across two
sequential plans, each built via `superpowers:subagent-driven-development`
(fresh Sonnet 5 implementer + Sonnet 5 task reviewer per task, Opus 5
whole-branch review, fix round, re-review) plus two rounds of fixes from
Davide's own manual click-through on each plan. Specs/plans:
`docs/superpowers/specs/2026-09-0{2,3}-notification-center*-design.md`,
`docs/superpowers/plans/2026-09-0{2,3}-notification-center*.md`.

Closes item 1 of the workout-wizard entry's queue. The bell (`TopHeader.jsx`)
had never been more than a hardcoded chat-unread shortcut. `notify_user()`
(`patches/010`) fired an external Web Push and persisted nothing; there was
no way to list, read, or clear a notification, and no way for a tapped OS
push to reconcile against anything in-app. Patch `020` added a
`notifications` table and extended `notify_user()` to insert a row before
it pushes; `NotificationsScreen.jsx` (shared by both roles, like
`ProfileScreen.jsx`) lists them, and every destination screen
(`ThreadScreen.jsx`, `MemberAppointmentsScreen.jsx`, `WorkoutPlanScreen.jsx`,
`MemberNutritionScreen.jsx`) marks its own type read on mount -- however the
visit happened, bell or not, matching an OS push tap for free since
`sw.js`'s `notificationclick` already just navigates.

Davide's first manual pass found three more: the appointment push showed
the wrong local time (`to_char` on a `timestamptz` formats in the trigger's
UTC session timezone unless told otherwise -- the exact `at time zone
'Europe/Rome'` fix already used for `reward_day` in `patches/016`), the
badge only updated on a 60s poll, and nothing let a user manage a growing
list. Patch `021` fixed the timezone and added five RPCs
(delete/bulk-mark-read/bulk-delete/mark-all/delete-all); a Realtime channel
on `AppLayout.jsx` (same pattern as `useThreadMessages.js`) made the badge
update in seconds; `NotificationsScreen.jsx` gained an All/Unread filter,
per-row delete, and a selection mode.

Two whole-branch reviews (Opus 5) each caught something no task-scoped
review could, by construction:

  - First plan: `verify.sql`'s four table/policy/grant counts, `probe-rls.
    mjs` never probing the new table (plus an `anon` grant patch 006's
    default privileges would otherwise have left standing even though RLS
    already denied it), and two older patches (`010`, `015`) whose own
    self-checks would hard-error if replayed after `020` dropped `notify_
    user()`'s old overload.
  - Second plan: `notifications` was never added to the `supabase_realtime`
    publication -- the SAME silent-failure mode `patches/007` already
    documented for `messages` ("connects, reports SUBSCRIBED, and simply
    never fires"), so the whole real-time-badge feature would have shipped
    as a no-op. Plus the patch-range docs drifting stale again, an
    unbounded offline-replayable "delete/mark all" that could silently
    destroy notifications the user never saw, and a keyboard-inaccessible
    selection mode.

Davide's second manual pass (after all of the above) found two more, both
UI-only, no SQL: the per-row delete had no confirmation (every other delete
action on the screen did), and selection mode had no bulk select-all.

RESUME HERE. The notification center is merged. Nothing is in flight.

Queued, in dependency order:

  1. Hardening and the report: re-run Lighthouse, capture screenshots for
     chapter 5, write chapters 4/5/6 and the slides, rewrite section 7 of
     `docs/superpowers/2026-07-30-device-verification.md` against the
     current workout flow and the notification center.
  2. A DB cleanup pass before submission, Davide's own item: `create_
     workout_session_secure`/`add_session_exercise_secure` (unreachable
     since the workout-wizard merge) are still worth a decision -- drop or
     leave. The professional side never got an event type in
     `notify_user()`'s four triggers (all four notify only the member) --
     out of scope when noted, still true, a separate decision if wanted.
