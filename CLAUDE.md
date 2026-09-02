# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # production build to dist/
npm run preview  # serve the built dist/ (only way to exercise the service worker)
npm run lint     # eslint over the repo
```

**`npm run lint` is not a sufficient check.** ESLint never resolves module
paths; Vite does, at build time. A MUI icon glyph the installed
`@mui/icons-material@9.2.0` does not ship (`ChatBubbleOutline`, `DeleteOutline`
— only the *styled* variants exist) passes lint and breaks the build. Run
**both** before calling anything done.

No test runner is configured and none is being added. Non-trivial pure logic
ships an `assert`-based `*.selfcheck.js` beside it, run with plain
`node <path>`. There are ten; run them all after touching shared code:

```bash
node src/lib/format.selfcheck.js
node src/lib/week.selfcheck.js
node src/theme/resolveTokens.selfcheck.js
node src/features/workout/timer.selfcheck.js
node src/features/workout/status.selfcheck.js
node src/features/workout/summary.selfcheck.js
node src/features/clients/subscription.selfcheck.js
node src/features/calendar/month.selfcheck.js
node src/features/progress/progress.selfcheck.js
node src/features/profile/pushSubscription.selfcheck.js
```

## What this is

University project (Univ. of Brescia, Mobile Application Development) — a
**PWA**, graded on both the app and a LaTeX technical report. Two roles with
separate sections: **member** (`/m/...`) and **professional** (`/p/...`).

Phases 0–3 are built and merged into `main`: the design system, the PWA shell,
auth, the member's workout half (live session, set logging, offline sync,
builder, rewards) and the professional's whole side (agenda, clients, plan and
nutrition editors, progress, calendar, availability).

Phase 4A — the member's nutrition, trainer and profile sections, booking,
settings with logout, and realtime chat — is merged into `main`.

Phase 4B — the member's QR access badge, the professional's scanner, and push
notifications end to end — is merged into `main`.

Phase 5A — the member's workout half rebuilt around `workout_runs`, so a plan
repeats weekly instead of finishing forever — is on the branch
`phase-5a-workout-redesign`, built and device-verified. Session state is now
DERIVED from the runs in the current ISO week rather than stored in
`workout_sessions.status`, which stays in the schema but is no longer read or
written. Its spec is `docs/superpowers/specs/2026-08-05-...`.

The professional's side of that rebuild is deliberately a separate, later spec.
`workout_runs.note` is written by the member and read by nobody until it lands.

## Where the project's memory lives

Read these before doing anything substantial. They carry decisions and
hard-won failures that the code alone does not explain.

- **`.superpowers/sdd/progress.md`** — the implementation ledger, one entry per
  task across every phase: what each review found, what was decided and why,
  and what is still deferred to a human. **After a context reset, trust this
  and `git log` over your own recollection.** It is where you resume from.
- `docs/superpowers/specs/2026-07-27-trainhub-design.md` — the design spec: the
  role-unification decision, the offline strategy, the schedule.
- `docs/superpowers/plans/*.md` — one implementation plan per phase, each with
  a Global Constraints section that is the contract for that phase's work.
- `.superpowers/sdd/phase*/task-*-report.md` — per-task implementer reports.

## Docs that drive the design

- `doc/context.md` — course + PWA requirements. Read before touching build or
  PWA config. The app must be installable, work offline, and use a **custom MUI
  theme** (`createTheme` + `responsiveFontSizes`), which is explicitly graded.
- `doc/assets/variables.tokens.json` — Figma design tokens. The single source
  for the palette; `src/theme/tokens.js` imports it directly so the app and the
  Figma file cannot drift. Brand `#FE6363`, background `#F9FAFB`, also in
  `vite.config.js`'s inline manifest — keep them in sync.
- `doc/assets/pt/*.png`, `doc/assets/gym_member/*.png`, `doc/assets/components/**`
  — the wireframes. Match them rather than inventing layout. Every deliberate
  departure is recorded in the owning phase's plan under "Deviations from the
  wireframes"; do not re-litigate those.
- `doc/trainhub.md` — the first navigation sketch. **Superseded** by section 4
  of the design spec, which is the routing spec.
- `doc/technical_report_examples/*.md` — prior-year reports showing the
  expected structure.

## Architecture

```
src/
  data/        Supabase only, no React. Plain async functions that throw.
  features/    React. Calls data/. One folder per domain.
  components/  Neither. Renders props.
  lib/         supabase client, queryClient, queryKeys, mutationKeys, format
  routes/      one route tree, lazy per screen
  theme/       createTheme + responsiveFontSizes, palette from the tokens
  sw.js        hand-written service worker (injectManifest)
```

- React 19 + Vite 8, plain JS + JSX (**no TypeScript**), ESM (`"type": "module"`).
- MUI v9 with Emotion. All styling goes through the theme — no CSS files, no
  colour literals. There is a custom `palette.task.*` group for the
  appointment-kind colours.
- React Router 8, data router, `lazy()` per screen.
- TanStack Query v5 with `persistQueryClient` over IndexedDB (`idb-keyval`).
  Queries are `networkMode: 'offlineFirst'`; mutations pause offline and are
  replayed by `resumePausedMutations`.
- Supabase for auth, Postgres, Row Level Security and Realtime.
- `vite-plugin-pwa` in `injectManifest` mode with a hand-written `src/sw.js`;
  the manifest is inline in `vite.config.js`. The service worker is not
  generated in `dev` — verify with `npm run build && npm run preview`.

## Rules that exist because breaking them cost a day

Each of these was a real defect found in review. They are not style.

- **Gate a read's error state on `data === undefined`, never on `isError`.**
  With `offlineFirst` a failed refetch leaves good cached data in place, and an
  error screen over usable data tells an offline user the app is broken while
  it is doing exactly what it was built for.
- **Every Supabase read carries `.retry(navigator.onLine)`.** postgrest retries
  a failed GET three times with 1s/2s/4s backoff, turning "offline" into seven
  seconds of blank screen. Writes must *not* — they are meant to pause.
- **Every write is registered in `src/data/mutations.js`** via
  `setMutationDefaults`. The persister stores a paused mutation *by key* and
  finds its function again through that registration; a rehydrated mutation
  with no registered default is discarded **silently**.
- **Call sites must not pass `onSettled` to `useMutation`** — the call site is
  spread last, so it *replaces* the registered handler. Per-call
  `mutate(vars, { onSuccess })` is a different mechanism and is safe.
- **A write whose order matters needs a `scope` on its registered default.**
  `resumePausedMutations` replays in parallel otherwise, and the older write
  can win.
- **A write that can be replayed needs a client-generated id.** `set_logs`,
  `messages`, `appointments`, `availability` all take one.
  `ignoreDuplicates: true` is right for insert-only writes and **wrong** for
  anything that is also the edit path — there it makes every correction a
  silent no-op.
- **`position` is `Math.max(0, ...positions) + 1`, never `length + 1`.**
  Against a `unique (parent, position)` constraint the two agree only while
  positions are contiguous, so counting collides the moment anything is deleted.
- **Dates: compute in the frame you mean.** `new Date('YYYY-MM-DD')` is UTC
  midnight and renders as the previous day west of Greenwich. Use `todayISO()`
  and `localDayISO()` from `src/lib/format.js`.
- **No `eslint-disable`, ever.** Several tasks were sent back for suppressing a
  `react-hooks` rule instead of fixing the code. If lint objects, the code is
  wrong. `react-hooks/refs` forbids touching `ref.current` during render;
  `react-hooks/purity` forbids `Date.now()` and `crypto.randomUUID()` in a
  render body — put them in an event handler.
- **RLS is the security boundary, and it is not the first gate.** Postgres
  checks the table `GRANT` *before* it evaluates any policy, so a table with
  perfect policies and no grant answers `42501 permission denied`. See
  `supabase/patches/006-restore-public-grants.sql`.
- **A policy whose `using` clause never mentions `auth.uid()` is public** to
  anyone holding the publishable key, which ships in the JS bundle. Phase 0
  shipped one; `verify.sql` cannot catch it, so RLS must be probed from an
  anonymous client.

## Database

`supabase/` is applied by hand in the Supabase SQL editor — no agent has
credentials, so any schema work ends in a handoff to Davide.

- `schema.sql`, `policies.sql`, `seed.sql` — a fresh install, in that order,
  after creating the two demo auth users with **Auto Confirm User** ticked.
- `patches/001`…`019` — applied in order on top. They also carry their own
  PASS/FAIL blocks. `009` (checkin tokens) and `010` (push notifications) are
  what Phase 4B's badge, scanner and push features depend on; `011` hardens the
  three oldest `security definer` functions against pg_temp shadowing.
  `015` rewrites every write as a secure RPC and revokes direct table
  grants; `017` widens plan creation to the member themselves, not only
  their assigned professional; `018` lets one plan-creation call bundle
  any number of sessions; `019` grows the exercise catalogue. All must be
  applied, in order, before the current `workout-creation-wizard` branch's
  code will work against the database.
- `probe-rls.mjs` — `node supabase/probe-rls.mjs`. Asks every table what it
  returns to a caller holding nothing but the publishable key, which ships in
  the JS bundle. `verify.sql` structurally cannot answer this: it runs as the
  dashboard's privileged role and bypasses RLS. Needs `.env.local`.
- `verify.sql` — run last, **after the patches**: its five schema and security
  counts expect `checkin_tokens` (`009`) and `app_config` (`010`) to exist. The
  three security rows and the two grant rows must read PASS. Three of them read
  17 against 18 tables on purpose — `app_config` is policy-less and grant-less
  by design. **Four seed-count rows read FAIL by design** once
  `patches/005-demo-clients.sql` has run; the comment in the file explains why
  the expectations are deliberately not bumped.

Demo accounts: `daniel@trainhub.dev` (member), `andrea@trainhub.dev`
(professional). Four extra demo clients exist as `auth.users` rows with no
identity — they cannot sign in by design.

## Working agreement

- **Commits are Davide's.** Conventional Commits, and **no `Co-Authored-By`
  trailer** — the history is his alone. Never merge or push without being
  asked.
- Stage only the files a task names. The working tree carries scratch
  bookkeeping under `.superpowers/sdd/` that must not enter a feature commit.
- Phases are planned before they are built: spec → plan → subagent-driven
  execution with a review per task and a whole-branch review at the end. The
  whole-branch review has caught a Critical in every phase so far, always
  something no single task owned.
