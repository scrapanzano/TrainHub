# TrainHub — briefing for an incoming agent

You are joining a project that is already ~80% built, has a written memory, and
has been burned by specific mistakes that are documented. Read this file first,
then the files it points you at. Do not start writing code from this file alone.

---

## 1. What TrainHub is

A **PWA** for a gym, built as a university project (Università di Brescia, Mobile
Application Development). It is graded on two things: the application *and* a
LaTeX technical report. The report is not an afterthought — half the marks.

Two roles, two route trees, one codebase:

- **member** — `/m/...` — workout plan, live training sessions, nutrition, their
  trainer, booking, chat, QR access badge, rewards.
- **professional** — `/p/...` — agenda, clients, plan and nutrition editors,
  progress charts, calendar, availability, badge scanner.

Course requirements that are explicitly graded, from `doc/context.md`: the app
must be **installable**, must **work offline**, and must use a **custom MUI
theme** (`createTheme` + `responsiveFontSizes`).

### Stack

React 19 + Vite 8, **plain JS and JSX — no TypeScript**, ESM. MUI v9 with
Emotion. React Router 8 (data router, `lazy()` per screen). TanStack Query v5
with `persistQueryClient` over IndexedDB. Supabase for auth, Postgres, Row Level
Security and Realtime. `vite-plugin-pwa` in `injectManifest` mode with a
hand-written `src/sw.js`.

### Architecture

```
src/
  data/        Supabase only, no React. Plain async functions that throw.
  features/    React. Calls data/. One folder per domain.
  components/  Neither. Renders props.
  lib/         supabase client, queryClient, queryKeys, mutationKeys, format, week
  routes/      one route tree, lazy per screen
  theme/       createTheme + responsiveFontSizes, palette from the Figma tokens
  sw.js        hand-written service worker
```

The dependency direction is **`features/` → `data/`**, never the reverse. A pure
module that both layers need lives in `lib/` — that is why `week.js` is there and
not beside the workout screens.

---

## 2. Read these before doing anything substantial

They carry decisions and hard-won failures that the code alone does not explain.
This is not optional background reading; it is where the project's reasoning
lives.

| Path | What it is |
|---|---|
| **`CLAUDE.md`** | The operating rules. Read it in full. It is short and every line in the "Rules that exist because breaking them cost a day" section is a real defect that shipped. |
| **`.superpowers/sdd/progress.md`** | **The implementation ledger.** One entry per task across every phase: what each review found, what was decided, what is still owed to a human. After any context loss, trust this and `git log` over your own recollection. It is where you resume from. |
| `docs/superpowers/specs/2026-07-27-trainhub-design.md` | The master design spec: role unification, offline strategy, the routing spec (section 4), the original schedule (section 7). |
| `docs/superpowers/specs/*-design.md` | One spec per phase. Each lists its decisions **against the alternative that was rejected**, which is what makes them reviewable later. |
| `docs/superpowers/plans/*.md` | One implementation plan per phase, each with a Global Constraints section that is the contract for that phase's work. |
| `docs/superpowers/2026-07-30-device-verification.md` | The human device-testing checklist, sections 0–9. Section 7 is now **stale** — it describes the pre-Phase-5A workout flow. |
| `doc/context.md` | Course and PWA requirements. Read before touching build or PWA config. |
| `doc/assets/variables.tokens.json` | Figma design tokens. `src/theme/tokens.js` imports this file directly so the app and the Figma file cannot drift. |
| `doc/assets/pt/*.png`, `doc/assets/gym_member/*.png` | The wireframes. Match them rather than inventing layout. Deliberate departures are recorded in the owning phase's plan under "Deviations from the wireframes" — do not re-litigate those. |
| `doc/technical_report_examples/*.md` | Prior-year reports showing the expected structure. |

`doc/trainhub.md` is the first navigation sketch and is **superseded** by section
4 of the design spec.

---

## 3. How this project works

Every phase runs: **spec → plan → task-by-task execution with a review per task
→ a whole-branch review at the end**. The whole-branch review has caught a
Critical in **every phase so far**, always something no single task owned. Do not
skip it.

Work happens on a branch named for the phase, merged to `main` by pull request.

### Non-negotiables

- **Commits belong to Davide.** Conventional Commits, and **no `Co-Authored-By`
  trailer** — the history is his alone.
- **Never push or merge without being asked. Never delete a branch.** Every phase
  branch since Phase 3 is still alive, deliberately.
- **No agent has Supabase credentials.** All schema work ends in a handoff:
  you write the patch, Davide applies it by hand in the SQL editor and pastes
  back the PASS/FAIL block.
- Stage only the files a task names.

### Verification

There is **no test runner and none is being added.** The equivalents are:

```bash
npm run lint     # eslint
npm run build    # Vite — this is the one that resolves module paths
```

**Both, always.** ESLint never resolves module paths; Vite does at build time. A
MUI icon glyph that `@mui/icons-material@9.2.0` does not ship (`DeleteOutline` —
only `DeleteOutlined` exists) passes lint and breaks the build.

Non-trivial pure logic ships an `assert`-based `*.selfcheck.js` beside it, run
with plain `node <path>`. There are ten; run them all after touching shared code.
The list is in `CLAUDE.md`.

Plus `node supabase/probe-rls.mjs`, which asks every table what it returns to a
caller holding only the publishable key.

---

## 4. Rules that exist because breaking them cost a day

Each was a real defect found in review. They are not style. The full list with
its reasoning is in `CLAUDE.md`; these are the ones that bite hardest.

- **Gate a read's error state on `data === undefined`, never on `isError`.** With
  `offlineFirst` a failed refetch leaves good cached data in place, and an error
  screen over usable data tells an offline user the app is broken while it is
  doing exactly what it was built for.
- **Every Supabase read carries `.retry(navigator.onLine)`.** Writes must **not**
  — they are meant to pause.
- **Every write is registered in `src/data/mutations.js`.** The persister stores
  a paused mutation *by key* and finds its function again through that
  registration; a rehydrated mutation with no registered default is discarded
  **silently**.
- **Call sites must not pass `onSettled` to `useMutation`** — the call site is
  spread last, so it *replaces* the registered handler.
- **A write whose order matters needs a `scope`.** `resumePausedMutations`
  replays in parallel otherwise.
- **A write that can be replayed needs a client-generated id.**
- **Per-call `mutate(vars, { onSuccess })` callbacks are NOT persisted.** Offline,
  a chain built on them breaks the moment the app is closed before reconnecting.
  This produced a real defect in Phase 5A.
- **`position` is `Math.max(0, ...positions) + 1`, never `length + 1`.**
- **Dates: compute in the frame you mean.** `new Date('YYYY-MM-DD')` is UTC
  midnight and renders as the previous day west of Greenwich. Use `todayISO()`,
  `localDayISO()` from `src/lib/format.js` and the helpers in `src/lib/week.js`.
- **No `eslint-disable`, ever.** Several tasks were sent back for suppressing a
  `react-hooks` rule instead of fixing the code. `react-hooks/purity` forbids
  `Date.now()` and `crypto.randomUUID()` in a render body — put them in an event
  handler.
- **RLS is the security boundary, and it is not the first gate.** Postgres checks
  the table `GRANT` *before* it evaluates any policy, so a table with perfect
  policies and no grant answers `42501 permission denied`.
- **A policy whose `using` clause never mentions `auth.uid()` is public** to
  anyone holding the publishable key, which ships in the JS bundle. Phase 0
  shipped one. `verify.sql` cannot catch it — `supabase/probe-rls.mjs` can.

---

## 5. Where the project stands

All phases are built and merged into `main`.

| Phase | What | State |
|---|---|---|
| 0–3 | Design system, PWA shell, auth, the member's workout half, the professional's whole side | merged |
| 4A | Member's nutrition, trainer and profile sections, booking, settings, realtime chat | merged |
| 4B | Member's QR access badge, professional's scanner, push notifications end to end | merged (PR #3) |
| 5A | The member's workout half rebuilt around runs | merged (PR #4, `53f732d`, 2026-08-06) |

Database: `schema.sql` + `policies.sql` + `seed.sql`, then patches `001`…`014` in
order, then `verify.sql`. All applied.

**The project is running roughly three weeks ahead of the original schedule** in
section 7 of the design spec, which had these phases closing on 24 August.

### The pivots — direction changes worth understanding

**1. Phase 4 was split into 4A and 4B.** Everything in 4B depended on something
outside the codebase — a camera, a real device, VAPID keys, a deployed Edge
Function — so it was separated to keep 4A unblocked.

**2. Hardening and the report were paused for Phase 5A.** A device walk on
2026-08-03 found the workout half was built against wireframes that describe a
workout happening **once**. A real training protocol repeats weekly for months.
Davide's call: refactor before hardening, because a redesign invalidates
device-walk results and report screenshots taken against the old flow.

**3. Phase 5A covers the MEMBER's side only.** Mid-phase, Davide split the
professional's half of the same rebuild into its own later spec. **Consequence,
recorded rather than hidden:** `workout_runs.note` is written by the member and
read by nobody until that spec lands. This is the acknowledged debt of 5A.

**4. The notification bell was deferred twice** — it needs its own design pass,
not a bug fix.

### What Phase 5A actually changed, because everything downstream assumes it

A session's state **stopped being a column** and became a function of the runs
inside the current ISO week. Every press of play opens a `workout_runs` row that
owns the clock, the outcome and the member's note; every `set_logs` row points at
one, which is what makes set counts restart each week.

There is no reset job — this project has no `pg_cron`. The week turns over
because the question changes.

`workout_sessions.status` still exists in the schema and is **read and written by
nobody**. Same for `workout_plans.expires_on`. Leaving an unused column is the
project's established precedent; removing one is a destructive migration on a
live database for no gain.

Nine defects were closed. Six of them were **latent** — invisible only because
nothing in the app repeated yet. The one worth internalising: the reward code was
`workout:${sessionId}` against `unique (member_id, code)` with
`ignoreDuplicates: true`, so the second completion of a session awarded
**nothing, silently**. It is now `workout:${runId}`.

---

## 6. What is queued, in dependency order

1. **The professional's side of the workout rebuild.** Its own spec. Includes
   surfacing `workout_runs.note` to the coach — the debt above — and probably a
   weekly view of a client now that runs exist. **This is the natural first piece
   of work for a new agent.**
2. **The notification bell.** Two things: the badge does not refresh within its
   60s poll (`AppLayout.jsx`), and the bell has **never been clickable at all**
   (`TopHeader.jsx` — the `IconButton` carries no `onClick` and no `Link`, unlike
   the profile avatar beside it). Not a regression; built that way. Davide wants
   tapping it to open a notifications view. **No screen for that exists — this is
   new scope and needs a design pass**: dropdown or screen, and what it lists.
3. **Hardening and the report.** Re-run Lighthouse, capture the screenshots for
   report chapter 5 (Lighthouse panel, DevTools → Application → Manifest and
   Service Workers), write LaTeX chapters 4, 5 and 6, build the slide deck.
   **Section 7 of the device-verification checklist must be rewritten against the
   new workout flow** rather than the old wording.

Deliberately out of scope, each with a reason on file: a history screen for
archived plans, a member-side progress screen, real exercise imagery or video,
dropping the now-unused columns, and reordering sessions or exercises.

---

## 7. Two things to know before you write anything

**The report needs raw material, and the ledger is where it comes from.** The
rest-timer audio story in `.superpowers/sdd/progress.md` is the model: three
causes in sequence (an `AudioContext` built outside a user gesture; Safari on iOS
routing Web Audio through the ambient category, which the ring/silent switch
mutes; then the chime seizing the audio session and cutting off the member's
music), ending at `navigator.audioSession.type = 'transient'`. That is a chapter
on PWA constraints written from measurements rather than from documentation. When
you hit a platform limit, write down what you measured.

**Claims need evidence.** This project's culture is that "it works" means a
command was run and its output read. If you did not run it, say so. Several
things in the ledger are recorded as *walked back* — statements that were made
from an API's documented behaviour rather than from a device, and turned out to
be wrong on iOS. Being explicit about what is unverified is not a weakness here;
it is the standard.
