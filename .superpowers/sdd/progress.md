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
