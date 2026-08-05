# Phase 5A — The Workout Half, Rebuilt: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the member's workout half cyclical, honest about effort, and self-service, by replacing the single `workout_sessions.status` column with runs derived per ISO week.

**Architecture:** Every press of play opens a `workout_runs` row that owns the clock, the outcome and the member's note; every `set_logs` row points at one. A session's state stops being stored and becomes a pure function of the runs inside the current ISO week. That single change makes the plan weekly, the set counting correct, the points proportional, the clock right, and abandoning safe without deleting anything.

**Tech Stack:** React 19, Vite 8, MUI v9 + Emotion, TanStack Query v5, React Router 8, Supabase (Postgres + RLS), plain JS/JSX, ESM.

**Spec:** `docs/superpowers/specs/2026-08-05-trainhub-workout-redesign-design.md`. Where this plan and the spec disagree, the spec wins — report the discrepancy rather than choosing.

## Global Constraints

Copied from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **No test runner exists and none is being added.** Non-trivial pure logic ships an `assert`-based `*.selfcheck.js` beside it, run with plain `node <path>`. React screens have no harness: their verification is `npm run lint`, `npm run build`, and the named manual steps.
- **`npm run lint` is not a sufficient check.** ESLint never resolves module paths; Vite does. Run **both** `npm run lint` and `npm run build` before calling any task done.
- **No `eslint-disable`, ever.** If lint objects, the code is wrong. `react-hooks/purity` forbids `Date.now()` and `crypto.randomUUID()` in a render body — put them in an event handler. `react-hooks/refs` forbids touching `ref.current` during render.
- **Gate a read's error state on `data === undefined`, never on `isError`.** With `offlineFirst` a failed refetch leaves good cached data in place.
- **Every Supabase read carries `.retry(navigator.onLine)`.** Writes must **not** — they are meant to pause.
- **Every write is registered in `src/data/mutations.js`** via `setMutationDefaults`. A rehydrated mutation with no registered default is discarded silently.
- **Call sites must not pass `onSettled` to `useMutation`** — the call site is spread last and would replace the registered handler. Per-call `mutate(vars, { onSuccess })` is a different mechanism and is safe.
- **A write whose order matters needs a `scope` on its registered default.**
- **A write that can be replayed needs a client-generated id.**
- **`position` is `Math.max(0, ...positions) + 1`, never `length + 1`.**
- **Dates: use `todayISO()` and `localDayISO()` from `src/lib/format.js`.** Never `new Date('YYYY-MM-DD')` — that is UTC midnight and renders as the previous day west of Greenwich.
- **All styling goes through the theme.** No CSS files, no colour literals.
- **MUI icon glyphs:** `@mui/icons-material@9.2.0` ships only styled variants of some icons — `DeleteOutlined`, not `DeleteOutline`. A wrong glyph passes lint and breaks the build.
- **Commits are Davide's.** Conventional Commits, **no `Co-Authored-By` trailer**. Stage only the files the task names — `.superpowers/sdd/` scratch must never enter a feature commit.
- **Never push or merge without being asked. Never delete a branch.**
- **No agent holds Supabase credentials.** Any schema work ends in a handoff to Davide.
- **Branch:** `phase-5a-workout-redesign`, already cut from `main` at `86e8c3a`.

### A note on the code in this plan

Complete code is given for every pure module, the SQL, the data layer, and each new component. For the four large existing screens (Tasks 6–9, 11) the plan gives the exact queries, handlers, props and the fragments that carry the spec's decisions, rather than reproducing hundreds of unchanged existing lines. Where a step says "keep the existing X", read the current file and keep it.

---

### Task 1: The weekly frame

The heart of the redesign: a session's state becomes a function of its runs and the current week. Pure, no imports, so the self-check runs under bare Node.

**Files:**
- Create: `src/features/workout/week.js`
- Create: `src/features/workout/week.selfcheck.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `mondayOf(dayISO: string) -> string` — the ISO week's Monday as `'YYYY-MM-DD'`.
  - `runStatusOf(runs: Array<{started_at: string, ended_at: ?string, outcome: ?string}>, weekStartISO: string) -> {status: 'todo'|'in_progress'|'completed'|'partial', run: ?object}` — `run` is the run that decided the status, or `null`.

- [ ] **Step 1: Write the failing self-check**

Create `src/features/workout/week.selfcheck.js`:

```js
// Run with:  node src/features/workout/week.selfcheck.js
import assert from 'node:assert/strict'
import { mondayOf, runStatusOf } from './week.js'

// --- mondayOf -------------------------------------------------------------
// 2026-08-05 is a Wednesday; its week starts Monday the 3rd.
assert.equal(mondayOf('2026-08-05'), '2026-08-03')
// A Monday is its own week start, not the one before.
assert.equal(mondayOf('2026-08-03'), '2026-08-03')
// Sunday belongs to the week that began six days earlier -- the ISO rule, and
// the reason getDay() cannot be used raw: it calls Sunday 0.
assert.equal(mondayOf('2026-08-09'), '2026-08-03')
// Across a month boundary.
assert.equal(mondayOf('2026-09-01'), '2026-08-31')
// Across a year boundary.
assert.equal(mondayOf('2027-01-01'), '2026-12-28')

// --- runStatusOf ----------------------------------------------------------
const WEEK = '2026-08-03'
const open = { id: 'r1', started_at: '2026-08-05T10:00:00+02:00', ended_at: null, outcome: null }
const done = { id: 'r2', started_at: '2026-08-04T10:00:00+02:00', ended_at: '2026-08-04T11:00:00+02:00', outcome: 'completed' }
const part = { id: 'r3', started_at: '2026-08-04T10:00:00+02:00', ended_at: '2026-08-04T10:30:00+02:00', outcome: 'partial' }
const quit = { id: 'r4', started_at: '2026-08-04T10:00:00+02:00', ended_at: '2026-08-04T10:05:00+02:00', outcome: 'abandoned' }
const lastWeek = { id: 'r5', started_at: '2026-07-29T10:00:00+02:00', ended_at: '2026-07-29T11:00:00+02:00', outcome: 'completed' }

assert.deepEqual(runStatusOf([], WEEK), { status: 'todo', run: null })
assert.deepEqual(runStatusOf([done], WEEK), { status: 'completed', run: done })
assert.deepEqual(runStatusOf([part], WEEK), { status: 'partial', run: part })

// An open run wins over anything else: it is what the member is doing NOW.
assert.deepEqual(runStatusOf([done, open], WEEK), { status: 'in_progress', run: open })
assert.deepEqual(runStatusOf([open], WEEK), { status: 'in_progress', run: open })

// Abandoned does not count -- the session is there to be done again.
assert.deepEqual(runStatusOf([quit], WEEK), { status: 'todo', run: null })
// ...but a completed run alongside an abandoned one still counts.
assert.deepEqual(runStatusOf([quit, done], WEEK), { status: 'completed', run: done })

// Last week's completion does not carry into this week. This is the whole point.
assert.deepEqual(runStatusOf([lastWeek], WEEK), { status: 'todo', run: null })

// Two closed runs in one week: the most recent decides.
const early = { id: 'r6', started_at: '2026-08-03T09:00:00+02:00', ended_at: '2026-08-03T09:20:00+02:00', outcome: 'partial' }
assert.deepEqual(runStatusOf([done, early], WEEK), { status: 'completed', run: done })
assert.deepEqual(runStatusOf([early, done], WEEK), { status: 'completed', run: done })

// An open run from a PREVIOUS week is still open -- the member never closed it.
// It must not be silently dropped, or the member is stranded with an open run
// the UI refuses to show while the database's unique index still blocks a new one.
const staleOpen = { id: 'r7', started_at: '2026-07-28T10:00:00+02:00', ended_at: null, outcome: null }
assert.deepEqual(runStatusOf([staleOpen], WEEK), { status: 'in_progress', run: staleOpen })

console.log('workout week: OK')
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node src/features/workout/week.selfcheck.js
```

Expected: `ERR_MODULE_NOT_FOUND` — `week.js` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/features/workout/week.js`:

```js
// The weekly frame the workout half turns on.  A session has no stored status:
// it is whatever its runs say inside the current ISO week.  No imports, so the
// self-check runs under bare Node.

/**
 * The Monday of `dayISO`'s ISO week, as `'YYYY-MM-DD'`.
 *
 * Built from local date parts rather than through `new Date('YYYY-MM-DD')`,
 * which is UTC midnight and lands on the previous day west of Greenwich -- the
 * difference between resetting the plan on Monday and resetting it on Sunday
 * evening for anyone in the Americas.
 *
 * `getDay()` calls Sunday 0, so it is remapped to 7 before subtracting: without
 * that, Sunday would be treated as the start of the week that is about to
 * begin rather than the end of the one just finished.
 */
export function mondayOf(dayISO) {
  const [year, month, day] = String(dayISO).slice(0, 10).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  date.setDate(date.getDate() - (weekday - 1))
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/**
 * What one session's runs say about it, for the week starting `weekStartISO`.
 *
 * Precedence, and why:
 *
 * 1. An OPEN run wins outright, whatever week it started in.  It is what the
 *    member is doing now, and a stale one left open last week must stay
 *    visible -- the database's partial unique index blocks a second open run,
 *    so hiding it would strand the member with no way to start anything.
 * 2. Otherwise the most recent run CLOSED INSIDE THIS WEEK decides, and its
 *    outcome is the status.
 * 3. `abandoned` is not a status.  It is the absence of one: the session is
 *    there to be done again, this week, from zero.
 *
 * Returns the deciding run too, because every caller that wants the status
 * also wants what it is holding -- the run id to resume, the day it was
 * completed on, the percentage it stopped at.
 */
export function runStatusOf(runs, weekStartISO) {
  const all = runs ?? []

  const open = all.find((run) => !run.ended_at)
  if (open) return { status: 'in_progress', run: open }

  const thisWeek = all
    .filter((run) => run.outcome === 'completed' || run.outcome === 'partial')
    .filter((run) => String(run.started_at).slice(0, 10) >= weekStartISO)
    // Lexicographic comparison of ISO timestamps is chronological, so no Date
    // objects are needed to find the most recent.
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))

  if (thisWeek.length === 0) return { status: 'todo', run: null }
  return { status: thisWeek[0].outcome, run: thisWeek[0] }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
node src/features/workout/week.selfcheck.js
```

Expected: `workout week: OK`

- [ ] **Step 5: Lint and build**

```bash
npm run lint && npm run build
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/week.js src/features/workout/week.selfcheck.js
git commit -m "feat(workout): derive session state from runs in the current ISO week"
```

---

### Task 2: Proportional points and the partial status

Closes defect 2 arithmetically and teaches the status lookup about `partial`.

**Files:**
- Modify: `src/features/workout/summary.js`
- Modify: `src/features/workout/summary.selfcheck.js`
- Modify: `src/features/workout/status.js`
- Modify: `src/features/workout/status.selfcheck.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pointsForRun(exercises: Array<{id, target_sets}>, countsByExercise: Map<string, number>|object) -> number`
  - `countsByExercise(logs: Array<{session_exercise_id}>) -> object` — plain object, id to count.
  - `sessionStatusOf('partial')` returns a distinct label and colour.
  - `planProgress(sessions)` counts a session as done when its `status` is `'completed'` **or** `'partial'`.

- [ ] **Step 1: Add the failing assertions**

Append to `src/features/workout/summary.selfcheck.js`, and add `countsByExercise, pointsForRun` to its existing import from `./summary.js`:

```js
// --- countsByExercise -----------------------------------------------------
assert.deepEqual(countsByExercise([]), {})
assert.deepEqual(
  countsByExercise([
    { session_exercise_id: 'a' },
    { session_exercise_id: 'a' },
    { session_exercise_id: 'b' },
  ]),
  { a: 2, b: 1 },
)

// --- pointsForRun ---------------------------------------------------------
const two = [{ id: 'a', target_sets: 3 }, { id: 'b', target_sets: 3 }]

// Nothing logged is nothing earned.  This is the defect found on device:
// the old code minted the full 30 points for an untouched session.
assert.equal(pointsForRun(two, {}), 0)
// Everything logged is the full award.
assert.equal(pointsForRun(two, { a: 3, b: 3 }), 30)
// Half the sets, half the points.
assert.equal(pointsForRun(two, { a: 3, b: 0 }), 15)
// Floor, not round: 4 of 6 sets is 20 points, not 20.000000000000004.
assert.equal(pointsForRun(two, { a: 3, b: 1 }), 20)
// Extra sets cannot inflate the award past the prescription.
assert.equal(pointsForRun(two, { a: 9, b: 9 }), 30)
// A count for an exercise no longer in the session is ignored, not added.
assert.equal(pointsForRun(two, { a: 3, b: 3, ghost: 5 }), 30)
// An empty session cannot divide by zero.
assert.equal(pointsForRun([], {}), 0)
// A session whose exercises prescribe nothing cannot divide by zero either.
assert.equal(pointsForRun([{ id: 'a', target_sets: 0 }], { a: 2 }), 0)
```

Append to `src/features/workout/status.selfcheck.js`:

```js
// `partial` is its own state: the member chose to stop early, which is neither
// "not done" nor "done as prescribed", and the card says which.
assert.deepEqual(sessionStatusOf('partial'), { label: 'Stopped Early', color: 'warning' })

// A partial counts towards the plan bar.  Counting only full completions would
// mean a member who ended one session early never sees the week reach 100%,
// which reads as an unfinished week rather than a finished-early one.
assert.deepEqual(
  planProgress([{ status: 'completed' }, { status: 'partial' }, { status: 'todo' }]),
  { completed: 2, total: 3, percent: 66 },
)
assert.deepEqual(
  planProgress([{ status: 'in_progress' }, { status: 'todo' }]),
  { completed: 0, total: 2, percent: 0 },
)
```

- [ ] **Step 2: Run both to verify they fail**

```bash
node src/features/workout/summary.selfcheck.js
node src/features/workout/status.selfcheck.js
```

Expected: the first fails on `countsByExercise is not defined`; the second fails on the `partial` label assertion.

- [ ] **Step 3: Implement in `summary.js`**

Add to `src/features/workout/summary.js`, leaving `POINTS`, `pointsForWorkout`, `summariseSession` and `rewardProgress` as they are — `pointsForWorkout()` still prints the headline figure on the Rewards screen:

```js
/** Sets logged per session_exercise, as a plain id-to-count object. */
export function countsByExercise(logs) {
  const counts = {}
  for (const log of logs ?? []) {
    counts[log.session_exercise_id] = (counts[log.session_exercise_id] ?? 0) + 1
  }
  return counts
}

/**
 * What one run is worth: the full award scaled by the share of prescribed sets
 * actually logged.
 *
 * Per-exercise counts are clamped to the prescription so an extra set cannot
 * inflate the total, and the divide is guarded because an empty session -- or
 * one whose exercises prescribe nothing -- is a real state that must yield 0
 * rather than NaN.
 *
 * Floor, not round: points may understate the work, never overstate it.
 */
export function pointsForRun(exercises, counts) {
  let done = 0
  let target = 0

  for (const exercise of exercises ?? []) {
    const prescribed = exercise.target_sets ?? 0
    target += prescribed
    done += Math.min(counts?.[exercise.id] ?? 0, prescribed)
  }

  if (target === 0) return 0
  return Math.floor(POINTS.workout * (done / target))
}
```

- [ ] **Step 4: Implement in `status.js`**

In `src/features/workout/status.js`, add `partial` to the frozen lookup and widen `planProgress`:

```js
const SESSION_STATUS = Object.freeze({
  todo: TODO,
  in_progress: Object.freeze({ label: 'In Progress', color: 'warning' }),
  completed: Object.freeze({ label: 'Completed', color: 'success' }),
  // Stopping early is a decision, not a failure, and not the same thing as
  // finishing.  It earns weighted points and it says so on the card.
  partial: Object.freeze({ label: 'Stopped Early', color: 'warning' }),
})
```

and, in `planProgress`, replace the `completed` filter with:

```js
  // A partial closes the session for the week just as a full completion does:
  // the bar answers "is the week done", the cards answer "how well".
  const completed = sessions.filter(
    (s) => s.status === 'completed' || s.status === 'partial',
  ).length
```

- [ ] **Step 5: Run both to verify they pass**

```bash
node src/features/workout/summary.selfcheck.js
node src/features/workout/status.selfcheck.js
```

Expected: `workout summary: OK` and `workout status: OK`.

- [ ] **Step 6: Lint and build**

```bash
npm run lint && npm run build
```

- [ ] **Step 7: Commit**

```bash
git add src/features/workout/summary.js src/features/workout/summary.selfcheck.js src/features/workout/status.js src/features/workout/status.selfcheck.js
git commit -m "feat(workout): weight a session's points by the sets actually logged"
```

---

### Task 3: The `workout_runs` table

**HUMAN HANDOFF. Everything after this task is dead until Davide applies the patch.** Write it, verify it reads correctly, commit it, and stop for him. Do not attempt to run it — no agent holds Supabase credentials.

**Files:**
- Create: `supabase/patches/013-workout-runs.sql`
- Modify: `supabase/verify.sql`

**Interfaces:**
- Produces: table `workout_runs`, type `run_outcome`, column `set_logs.run_id`.

- [ ] **Step 1: Write the patch**

Create `supabase/patches/013-workout-runs.sql`:

```sql
-- Patch 013 -- one row per attempt at a workout session.
--
-- WHAT THIS REPLACES
--
-- `workout_sessions.status` was a single enum column: one session, one state,
-- forever. A real training protocol repeats weekly for three or four months,
-- so that column answers the wrong question -- it says "was this session ever
-- done" when the app needs "was it done THIS week".
--
-- Worse, `set_logs` had no attempt to belong to, so the embedded count in
-- `src/data/workouts.js` was a LIFETIME total. In week two a three-set
-- exercise would have read `6/3` and nothing would ever have completed again.
--
-- WHY THE FIX IS SHAPED THIS WAY
--
-- A run owns the clock, the outcome and the member's note, and every set
-- points at one. Session state stops being stored and becomes a function of
-- the runs inside the current ISO week (`src/features/workout/week.js`), so
-- there is no reset job to schedule -- and Supabase has no pg_cron here to
-- schedule one on.
--
-- It also removes any need to delete a set. Abandoning marks the run and
-- leaves its rows alone. A DELETE would have to race the offline replay queue:
-- a set logged underground can land AFTER the delete meant to remove it, and
-- no ordering fixes that in general.
--
-- `workout_sessions.status` is deliberately NOT dropped. It stops being read
-- and written by the application from this patch onward; removing the column
-- would be a destructive migration on a live database for no gain.
--
-- ORDERING
--
-- Depends on schema.sql (workout_sessions, set_logs, profiles) and on
-- patches/006 for the default privileges this table inherits. Independent of
-- 009 through 012.
--
-- Idempotent: every statement is guarded, safe to run any number of times.

do $$ begin
  create type run_outcome as enum ('completed', 'partial', 'abandoned');
exception when duplicate_object then null;
end $$;

create table if not exists workout_runs (
  id              uuid primary key,
  session_id      uuid not null references workout_sessions(id) on delete cascade,
  member_id       uuid not null references profiles(id) on delete cascade,
  -- Supplied by the client, never defaulted to now(), for the same reason
  -- set_logs.performed_at is: this write can sit paused offline for hours and
  -- be replayed on reconnect, and now() at insert time would record a workout
  -- that started at 18:00 as starting at 23:00.
  started_at      timestamptz not null,
  paused_at       timestamptz,
  paused_total_ms int not null default 0,
  ended_at        timestamptz,
  outcome         run_outcome,
  note            text
);

create index if not exists workout_runs_member_started_idx
  on workout_runs (member_id, started_at desc);
create index if not exists workout_runs_session_started_idx
  on workout_runs (session_id, started_at desc);

-- At most one open workout per member, enforced here and not only in the UI:
-- two phones signed into one account must not be able to open two.
create unique index if not exists workout_runs_one_open_per_member
  on workout_runs (member_id) where ended_at is null;

alter table set_logs add column if not exists run_id uuid
  references workout_runs(id) on delete cascade;
create index if not exists set_logs_run_idx on set_logs (run_id);

alter table workout_runs enable row level security;

-- The member owns their runs outright.  `owns_member` grants the professional
-- read access to their own clients' runs and nothing more: a trainer may see
-- that a workout happened and how it went, and may never invent one.
drop policy if exists workout_runs_select on workout_runs;
create policy workout_runs_select on workout_runs
  for select using (owns_member(member_id));

drop policy if exists workout_runs_write_self on workout_runs;
create policy workout_runs_write_self on workout_runs
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- Every row must read PASS.
--
-- `member can insert` FAIL means the table was created without inheriting the
-- grants patches/006 installed as default privileges. RLS would then be
-- irrelevant: Postgres checks the grant BEFORE any policy and answers
-- "42501 permission denied" one gate earlier.
select 'table exists' as check,
  (to_regclass('public.workout_runs') is not null) as ok
union all
select 'rls enabled',
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'workout_runs')
union all
select 'two policies',
  (select count(*) = 2 from pg_policies
   where schemaname = 'public' and tablename = 'workout_runs')
union all
select 'one open run per member enforced',
  (select count(*) = 1 from pg_indexes
   where schemaname = 'public' and tablename = 'workout_runs'
     and indexdef ilike '%unique%' and indexdef ilike '%ended_at is null%')
union all
select 'set_logs.run_id exists',
  (select count(*) = 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'set_logs' and column_name = 'run_id')
union all
select 'member can insert',
  has_table_privilege('authenticated', 'public.workout_runs', 'insert')
union all
select 'member can select',
  has_table_privilege('authenticated', 'public.workout_runs', 'select');
```

- [ ] **Step 2: Update `verify.sql`'s counts**

`workout_runs` is the nineteenth table and, unlike `app_config`, it has both policies and grants. In `supabase/verify.sql` change:

- the two `'18'` expectations (base-table count, rowsecurity count) to `'19'`
- the three `'17'` expectations (distinct tables with policies, and the two grant counts) to `'18'`

and update the two comments that explain those numbers so they name `workout_runs` — the comment at line 26 that enumerates where 18 comes from, and the one at line 40 explaining why three counts read one short. The gap of one is still `app_config`, which remains policy-less and grant-less by design.

- [ ] **Step 3: Verify the patch reads correctly**

There is nothing to execute. Re-read the file and confirm by eye:

- every relation is unqualified but the patch does **not** create a `security definer` function, so the `search_path` hardening of patches 009/011 does not apply here
- both policies name `auth.uid()`, directly or through `owns_member` — a policy whose `using` clause never mentions it is public to anyone holding the publishable key, which ships in the JS bundle
- every statement is `if not exists` / `drop ... if exists`, so a second run is a no-op

- [ ] **Step 4: Commit**

```bash
git add supabase/patches/013-workout-runs.sql supabase/verify.sql
git commit -m "feat(db): add workout_runs and scope set_logs to a run"
```

- [ ] **Step 5: Hand off to Davide and STOP**

Tell him, in these terms:

> `supabase/patches/013-workout-runs.sql` is ready. Apply it in the Supabase SQL editor and paste back the seven-row PASS/FAIL block. Then re-run `supabase/verify.sql`: its table counts now expect 19 and 18 where they used to read 18 and 17, and the four seed-count rows still read FAIL by design.
>
> One check the SQL cannot do for itself: sign in as `daniel@trainhub.dev` and confirm a member cannot read another member's runs. `verify.sql` cannot catch a policy that never mentions `auth.uid()` — Phase 0 shipped exactly one of those.

Do not begin Task 4 until he confirms the patch landed.

---

### Task 4: The data layer

**Files:**
- Create: `src/data/runs.js`
- Modify: `src/data/workouts.js`
- Modify: `src/data/mutations.js`
- Modify: `src/lib/queryKeys.js`
- Modify: `src/lib/mutationKeys.js`

**Interfaces:**
- Consumes: `mondayOf` from Task 1.
- Produces:
  - `startRun({id, sessionId, memberId, startedAt})`, `pauseRun({id, pausedAt})`, `resumeRun({id, pausedTotalMs})`, `endRun({id, endedAt, outcome, note})`
  - `fetchOpenRun(memberId) -> ?run`, `fetchRunsForPlan(memberId, sinceISO) -> run[]`, `fetchRunLogs(runId) -> log[]`
  - `queryKeys.openRun(memberId)`, `queryKeys.planRuns(memberId, weekISO)`, `queryKeys.runLogs(runId)`; `queryPrefixes.runs`
  - `mutationKeys.startRun|pauseRun|resumeRun|endRun`
  - `fetchActivePlan` gains `weekStart` and per-session `runs`; `fetchSession` drops its lifetime `set_logs(count)`; `logSet` takes `runId`.

- [ ] **Step 1: Add the keys**

In `src/lib/queryKeys.js`, add to `queryKeys`:

```js
  // Every run key starts with 'runs', so one prefix invalidates the open run,
  // the plan's week and any loaded run's logs together.
  openRun: (memberId) => ['runs', 'open', memberId],
  planRuns: (memberId, weekISO) => ['runs', 'week', memberId, weekISO],
  runLogs: (runId) => ['runs', 'logs', runId],
```

and to `queryPrefixes`:

```js
  runs: ['runs'],
```

In `src/lib/mutationKeys.js`, add:

```js
  startRun: ['startRun'],
  pauseRun: ['pauseRun'],
  resumeRun: ['resumeRun'],
  endRun: ['endRun'],
```

- [ ] **Step 2: Write `src/data/runs.js`**

```js
import { supabase } from '../lib/supabase.js'

// Reads carry `.retry(navigator.onLine)`; writes deliberately do not -- they
// are meant to pause offline and be replayed by `resumePausedMutations`.

const RUN_COLUMNS = 'id, session_id, member_id, started_at, paused_at, paused_total_ms, ended_at, outcome, note'

/**
 * The member's open workout, if there is one.
 *
 * Answers two questions with one read: what the mini-player should show, and
 * whether pressing play on another session must first ask about this one.
 * `maybeSingle` rather than `single` because having no workout open is the
 * ordinary case, not an error -- and the partial unique index in patches/013
 * guarantees there is never more than one.
 */
export async function fetchOpenRun(memberId) {
  const { data, error } = await supabase
    .from('workout_runs')
    .select(`${RUN_COLUMNS}, session:workout_sessions ( id, name, plan_id )`)
    .eq('member_id', memberId)
    .is('ended_at', null)
    .maybeSingle()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/** Every run this member started on or after `sinceISO`, newest first. */
export async function fetchRunsForPlan(memberId, sinceISO) {
  const { data, error } = await supabase
    .from('workout_runs')
    .select(RUN_COLUMNS)
    .eq('member_id', memberId)
    // A bare 'YYYY-MM-DD' compares correctly against a timestamptz: Postgres
    // casts it to midnight of that day in the session's zone.
    .gte('started_at', sinceISO)
    .order('started_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * The sets logged inside one run.
 *
 * This is what makes the `2/3` pills restart every week and after every
 * abandon: the count is scoped to an attempt, not to all of history.
 */
export async function fetchRunLogs(runId) {
  const { data, error } = await supabase
    .from('set_logs')
    .select('id, session_exercise_id, set_number, reps, weight, performed_at')
    .eq('run_id', runId)
    .order('performed_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Open a workout.
 *
 * The caller supplies `id` and `startedAt`.  The id is the idempotency key: a
 * replayed insert must land on the same row rather than open a second run and
 * trip `workout_runs_one_open_per_member`.  The timestamp is the caller's
 * because this write can sit paused for hours -- the database's clock at
 * insert time would record an 18:00 workout as starting at 23:00.
 *
 * `ignoreDuplicates` is correct here: this function is insert-only.  The three
 * below are the edit path and must NOT use it, or every correction would be a
 * silent no-op.
 */
export async function startRun({ id, sessionId, memberId, startedAt }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .upsert(
      { id, session_id: sessionId, member_id: memberId, started_at: startedAt },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select(RUN_COLUMNS)
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success, not a gap.
  return data
}

/** Freeze the clock. */
export async function pauseRun({ id, pausedAt }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .update({ paused_at: pausedAt })
    .eq('id', id)
    .select(RUN_COLUMNS)
    .single()

  if (error) throw error
  return data
}

/**
 * Restart the clock, crediting the paused stretch.
 *
 * The caller computes `pausedTotalMs` with `resumeTimer` from `timer.js`, which
 * clamps a backwards clock correction -- a negative total would be subtracted
 * from every later reading and inflate the clock permanently rather than once.
 */
export async function resumeRun({ id, pausedTotalMs }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .update({ paused_at: null, paused_total_ms: pausedTotalMs })
    .eq('id', id)
    .select(RUN_COLUMNS)
    .single()

  if (error) throw error
  return data
}

/**
 * Close a workout.
 *
 * `outcome` is one of 'completed', 'partial' or 'abandoned'.  Writing
 * `ended_at` is what releases the partial unique index and lets the member
 * start something else.  Idempotent by nature: closing an already-closed run
 * writes the same values.
 */
export async function endRun({ id, endedAt, outcome, note }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .update({ ended_at: endedAt, outcome, note: note ?? null })
    .eq('id', id)
    .select(RUN_COLUMNS)
    .single()

  if (error) throw error
  return data
}
```

- [ ] **Step 3: Rework `src/data/workouts.js`**

Three changes. First, `SESSION_EXERCISE_COLUMNS` drops the embedded aggregate — it was the lifetime count, and counts now come from `fetchRunLogs` scoped to an attempt:

```js
const SESSION_EXERCISE_COLUMNS = `
  id, position, target_sets, target_reps, target_weight, rest_seconds, notes,
  exercise:exercises ( id, name, muscle_group, equipment, instructions, video_url, image_url )
`
```

Delete the `withLoggedCount` helper and every use of it — `fetchSession` and `fetchSessionExercise` now return rows unchanged apart from the sort.

Second, `fetchActivePlan` returns the week and each session's runs. Keep the existing plan and sessions queries; add a third read and attach:

```js
import { mondayOf } from '../features/workout/week.js'
import { todayISO } from '../lib/format.js'
import { fetchRunsForPlan } from './runs.js'

// ...inside fetchActivePlan, after the sessions query:

  // One read for the whole plan's week, grouped here, rather than one per
  // session: a plan has a handful of sessions and this is a single round trip.
  const weekStart = mondayOf(todayISO())
  const runs = await fetchRunsForPlan(memberId, weekStart)

  return {
    plan,
    weekStart,
    sessions: (sessions ?? []).map(({ session_exercises: exercises, ...session }) => ({
      ...session,
      exerciseCount: exercises?.[0]?.count ?? 0,
      runs: runs.filter((run) => run.session_id === session.id),
    })),
  }
```

An open run started before this Monday would fall outside that read. Widen the window by fetching from `mondayOf` of *last* week rather than this one, and let `runStatusOf` decide — it already treats an open run as authoritative whatever week it began in:

```js
  const weekStart = mondayOf(todayISO())
  // Reach back a week so a run left open last Sunday is still visible.
  // `runStatusOf` decides what counts; this read only has to not hide it.
  const since = mondayOf(new Date(Date.parse(`${weekStart}T00:00:00`) - 7 * 86_400_000).toISOString().slice(0, 10))
  const runs = await fetchRunsForPlan(memberId, since)
```

Third, `logSet` takes `runId` and writes it:

```js
export async function logSet({
  id, runId, sessionExerciseId, memberId, setNumber, reps, weight, performedAt,
}) {
  const { data, error } = await supabase
    .from('set_logs')
    .upsert(
      {
        id,
        run_id: runId,
        session_exercise_id: sessionExerciseId,
        member_id: memberId,
        set_number: setNumber,
        reps,
        weight: weight ?? null,
        performed_at: performedAt ?? new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  return data
}
```

Leave `setSessionStatus` in place but stop calling it — the column is no longer the source of truth. Delete `deleteSession`'s neighbours at your peril: `createPlan`, `createSession`, `deleteSession` and `fetchExerciseCatalogue` are all still used.

- [ ] **Step 4: Register the writes**

In `src/data/mutations.js`, import the four run functions and register them. **All four, plus `logSet`, share one scope.** `set_logs.run_id` is a foreign key and `resumePausedMutations` replays in parallel without a scope, so an unscoped replay can land a set before the run it references and fail on the constraint:

```js
  // One scope across the whole workout: `set_logs.run_id` is a foreign key, so
  // the run must land before its sets, and pause/resume/end must land in the
  // order they happened.  Without this they replay in parallel and the
  // reconnect after a session logged underground fails on the constraint.
  const runScope = { id: 'workoutRun' }

  queryClient.setMutationDefaults(mutationKeys.startRun, {
    mutationFn: startRun,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.pauseRun, {
    mutationFn: pauseRun,
    scope: runScope,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryPrefixes.runs }),
  })

  queryClient.setMutationDefaults(mutationKeys.resumeRun, {
    mutationFn: resumeRun,
    scope: runScope,
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryPrefixes.runs }),
  })

  queryClient.setMutationDefaults(mutationKeys.endRun, {
    mutationFn: endRun,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })
```

and add `scope: runScope` plus a `queryPrefixes.runs` invalidation to the **existing** `logSet` registration, keeping its current `sessionLogs` and `session` invalidations.

- [ ] **Step 5: Lint and build**

```bash
npm run lint && npm run build
```

Expected: both exit 0. The build will fail on call sites that still pass the removed `loggedCount` — that is Tasks 6–9's work, so if the failure is only in screens named there, note it and continue; if it is anywhere else, fix it here.

- [ ] **Step 6: Commit**

```bash
git add src/data/runs.js src/data/workouts.js src/data/mutations.js src/lib/queryKeys.js src/lib/mutationKeys.js
git commit -m "feat(workout): scope set counting to a run and register the run writes"
```

---

### Task 5: One plan-creation flow for both roles

Closes defect 7 (the member cannot create a plan) and defect 8 (an empty plan hides the coach's), the latter on both sides at once.

**Files:**
- Create: `src/features/workout/PlanForm.jsx` (lifted from `ClientWorkoutScreen.jsx:20-86`)
- Create: `src/features/workout/CreatePlanFlow.jsx`
- Modify: `src/features/clients/ClientWorkoutScreen.jsx`
- Modify: `src/routes/index.jsx`
- Delete: `src/features/workout/WorkoutBuilderScreen.jsx`

**Interfaces:**
- Produces: `<CreatePlanFlow memberId authorId onDone />` — runs both steps and performs a single write at the end.

- [ ] **Step 1: Extract `PlanForm.jsx`**

Move `NewPlanForm` out of `ClientWorkoutScreen.jsx` verbatim into `src/features/workout/PlanForm.jsx` as the default export named `PlanForm`, keeping `LEVELS` with it. Two changes only: it takes a `submitLabel` prop defaulting to `'Continue'`, and its offline `Alert` and error `Alert` move to the flow that owns the write — a form that no longer writes must not claim to.

- [ ] **Step 2: Write `CreatePlanFlow.jsx`**

```jsx
import { useState } from 'react'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PlanForm from './PlanForm.jsx'
import SessionForm from './SessionForm.jsx'

/**
 * Build a plan and its first session, in that order, writing once at the end.
 *
 * The write is deferred deliberately.  `fetchActivePlan` takes the newest plan
 * by `created_at`, so a plan saved before its first session exists would
 * instantly hide whatever came before it -- including a plan a coach spent an
 * afternoon writing.  Nothing is created until there is something worth
 * showing, which also enforces the rule that a session must hold at least one
 * exercise.
 *
 * Used by both roles.  Only `memberId`, `authorId` and `onDone` differ.
 */
export default function CreatePlanFlow({ memberId, authorId, onDone }) {
  const [meta, setMeta] = useState(null)

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const createPlan = useMutation({ mutationKey: mutationKeys.createPlan })
  const createSession = useMutation({ mutationKey: mutationKeys.createSession })

  const pending = createPlan.isPending || createSession.isPending
  const paused = pending && (createPlan.isPaused || createSession.isPaused)
  const error = createPlan.error ?? createSession.error

  if (meta === null) {
    return (
      <Stack spacing={3}>
        <Typography variant="h1">New plan</Typography>
        <PlanForm onSubmit={setMeta} submitLabel="Continue" />
      </Stack>
    )
  }

  if (catalogue.isPending) return <LoadingState />
  // Ungated, `catalogue.data` is undefined and MUI's useAutocomplete calls
  // `options.filter()` the moment the popup opens.  With no errorElement in the
  // route tree that throw replaces the whole app with the root boundary.
  if (catalogue.isError && catalogue.data === undefined) {
    return <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  }

  const onSubmit = ({ name, exercises }) => {
    // Generated in the handler, not during render: `react-hooks/purity`
    // forbids `crypto.randomUUID()` in a render body, and this is the
    // idempotency key both writes upsert on.
    const planId = crypto.randomUUID()

    createPlan.mutate(
      { id: planId, memberId, authorId, ...meta },
      {
        onSuccess: () =>
          createSession.mutate(
            { planId, name, position: 1, exercises },
            { onSuccess: onDone },
          ),
      },
    )
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h1">First session</Typography>
        <Typography color="text.secondary">
          {meta.name} — a plan needs at least one session to exist.
        </Typography>
      </Stack>

      <SessionForm
        catalogue={catalogue.data}
        onSubmit={onSubmit}
        pending={pending}
        paused={paused}
        submitLabel="Create plan"
      />

      {/* Offline the mutations pause: `onSuccess` never runs, no error is
          raised, and the button would sit on "Saving…" with nothing to
          explain it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. The plan is saved on your device and will be created
          when you reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">{error.message ?? 'The plan could not be created.'}</Alert>
      ) : null}

      <Button onClick={() => setMeta(null)} disabled={pending}>
        Back
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 3: Mount it on both sides**

In `ClientWorkoutScreen.jsx`, replace the whole `plan.data === null` branch with:

```jsx
  if (plan.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography color="text.secondary">
          {clientName} has no workout plan yet.
        </Typography>
        <CreatePlanFlow
          memberId={clientId}
          authorId={user.id}
          onDone={() => plan.refetch()}
        />
      </Stack>
    )
  }
```

Remove the now-unused `NewPlanForm` and the `createPlan` mutation from that file.

In `src/routes/index.jsx`, repoint `workout/builder` at a new member screen that renders `<CreatePlanFlow memberId={user.id} authorId={user.id} onDone={() => navigate('/m/workout', { replace: true })} />`, and delete `WorkoutBuilderScreen.jsx`.

- [ ] **Step 4: Lint, build, and walk it**

```bash
npm run lint && npm run build && npm run preview
```

As `daniel@trainhub.dev`, reach `/m/workout/builder`, fill step one, and press Back — nothing has been written. Complete both steps and confirm the plan appears with its session.

As `andrea@trainhub.dev`, open a client with no plan and confirm the same two steps, landing back on the client's plan.

- [ ] **Step 5: Commit**

```bash
git add src/features/workout/PlanForm.jsx src/features/workout/CreatePlanFlow.jsx src/features/clients/ClientWorkoutScreen.jsx src/routes/index.jsx
git rm src/features/workout/WorkoutBuilderScreen.jsx
git commit -m "feat(workout): one deferred-write plan creation flow for both roles"
```

---

### Task 6: The plan screen

**Files:**
- Modify: `src/features/workout/WorkoutPlanScreen.jsx`
- Modify: `src/components/SessionCard.jsx`

Read both files first. The banner, the card list and the progress bar already exist; this task changes what feeds them and adds two modes.

- [ ] **Step 1: Derive each session's state**

Replace the `session.status` read with `runStatusOf(session.runs, data.weekStart)` from Task 1, and pass both the status and the deciding run into `SessionCard`. `planProgress` now receives `sessions.map((s) => ({ status: runStatusOf(s.runs, data.weekStart).status }))`.

- [ ] **Step 2: Teach `SessionCard` to say what happened**

The card gains a second line under the status: `formatDate(localDayISO(run.ended_at))` for a completion, the percentage for a partial, and for a `todo` session whose most recent run is older than `weekStart`, "skipped last week". Use `sessionStatusOf` for the label and colour — do not hard-code either.

- [ ] **Step 3: Drop the expiry, keep the duration**

Remove the `plan.expires_on` block and its `formatDate` import if now unused. The banner keeps `Duration: {plan.weeks} weeks`.

- [ ] **Step 4: Add the overflow menu**

An `IconButton` with `MoreVertIcon` at the banner's top right, opening a `Menu` with:

- *Create a new Workout Plan* — always present. Opens a confirmation naming the current plan and stating plainly that it will be replaced, then routes to the creation flow.
- *Edit Workout Plan* — rendered only when `plan.author?.id === user.id`, per the rule that a plan is editable by its creator alone.

- [ ] **Step 5: Add edit mode**

`const [editing, setEditing] = useState(false)`. While editing: the FAB is replaced by an *Add session* button at the end of the list, each card shows a `DeleteOutlinedIcon` instead of its chevron and stops linking, and a Cancel/Done bar sits above the list. Deleting calls the existing `deleteSession` mutation behind a `window.confirm` that names the session and its exercise count, matching how `ClientWorkoutScreen.jsx:193` already phrases it.

- [ ] **Step 6: Add the empty-state fork**

When `data` is null, replace the current `EmptyState` with the fork: if `profile.professional_id` is set, *Book with {name}* beside *Build it myself*; otherwise *Choose a coach* beside *Build it myself*. Check the profile shape in `src/data/profile.js` for the real field name before writing this.

- [ ] **Step 7: Lint, build, walk**

```bash
npm run lint && npm run build && npm run preview
```

Confirm: the states match the runs; the bar counts partials; no expiry line; the menu hides *Edit* on a coach-authored plan; edit mode deletes behind a confirmation; the empty state shows the right fork.

- [ ] **Step 8: Commit**

```bash
git add src/features/workout/WorkoutPlanScreen.jsx src/components/SessionCard.jsx
git commit -m "feat(workout): weekly states, overflow menu and edit mode on the plan screen"
```

---

### Task 7: The session screen

**Files:**
- Modify: `src/features/workout/SessionDetailScreen.jsx`

- [ ] **Step 1: Show this week's state**

Query `queryKeys.planRuns` for the member's week and filter to this session, then `runStatusOf`. Show the label beside the exercise count.

- [ ] **Step 2: Gate the play control**

Play opens a confirmation dialog before starting. If `fetchOpenRun` returns a run for a **different** session, show the exclusivity sheet of Task 8 instead. If it returns a run for **this** session, the control reads *Resume* and routes straight to `/live`.

- [ ] **Step 3: Add edit mode**

The same pattern as Task 6, over the exercise list: an overflow menu entry *Edit session*, hidden entirely while a run is open on this session, and shown only to the plan's author. Removing an exercise deletes the `session_exercises` row behind a confirmation.

This needs a `deleteSessionExercise` in `src/data/workouts.js`, registered in `mutations.js` invalidating `queryPrefixes.session` and `queryPrefixes.plan`. It is a plain idempotent delete, so it needs no client-generated id — deleting a row that is already gone affects nothing and does not error.

- [ ] **Step 4: Lint, build, walk, commit**

```bash
npm run lint && npm run build
git add src/features/workout/SessionDetailScreen.jsx src/data/workouts.js src/data/mutations.js
git commit -m "feat(workout): weekly state, guarded play and edit mode on the session screen"
```

---

### Task 8: The live session

**Files:**
- Modify: `src/features/workout/LiveSessionScreen.jsx`
- Modify: `src/features/workout/useLiveSession.js`
- Create: `src/features/workout/EndRunSheet.jsx`
- Create: `src/features/workout/CongratsDialog.jsx`
- Create: `src/features/workout/OpenRunSheet.jsx`

- [ ] **Step 1: Move the clock onto the run**

Rewrite `useLiveSession.js` to take a run rather than a session id. It keeps using `timer.js` unchanged — `{ startedAt: Date.parse(run.started_at), pausedAt: run.paused_at ? Date.parse(run.paused_at) : null, pausedTotal: run.paused_total_ms }` — and its `pause`/`resume` call the mutations instead of writing `localStorage`. Delete the `storageKey`/`readStored` helpers and the `loadedFor` correction: the bug they worked around was the session-keyed storage, and a run id keys a fresh row.

- [ ] **Step 2: Remove the "current exercise" highlight**

Per §101 of the brainstorm, delete `currentId` and the `isCurrent` border. Sequencing cannot be honoured when a machine is occupied. Completed cards keep their reduced opacity and their tick; every card stays tappable.

- [ ] **Step 3: Count from the run's logs**

Replace `item.loggedCount` with `countsByExercise(runLogs)[item.id] ?? 0` from Task 2, where `runLogs` comes from `queryKeys.runLogs(run.id)`.

- [ ] **Step 4: Write `CongratsDialog.jsx`**

A `Dialog` with a single action. It opens when every exercise has reached its target — computed from the same counts, so it fires the moment the last set lands optimistically. Its button closes the run with outcome `'completed'` and navigates to the summary.

- [ ] **Step 5: Write `EndRunSheet.jsx`**

A bottom `Drawer` with `role="dialog"` stating the completion percentage, then two actions and a cancel:

- **Finish workout** — `endRun` with outcome `'partial'`, keeping the sets, awarding `pointsForRun`, then the summary.
- **Abandon** — `color="error"`, `endRun` with outcome `'abandoned'`, no reward, back to `/m/workout`. Its copy must say the sets logged today will not count.

- [ ] **Step 6: Write `OpenRunSheet.jsx`**

Shown when play is pressed with another session's run open. Names the open session and how long it has been running, and offers *Return to it*, *Abandon it and start this one*, and *Cancel*. Nothing closes silently.

- [ ] **Step 7: Fix the reward code**

In whichever handler awards, the code becomes `` `workout:${run.id}` `` and the points `pointsForRun(exercises, counts)`. This is defect 6: `rewards` has `unique (member_id, code)` and `awardReward` uses `ignoreDuplicates: true`, so the old per-session code would have made every repeat week award nothing.

- [ ] **Step 8: Lint, build, walk, commit**

```bash
npm run lint && npm run build
git add src/features/workout/LiveSessionScreen.jsx src/features/workout/useLiveSession.js src/features/workout/EndRunSheet.jsx src/features/workout/CongratsDialog.jsx src/features/workout/OpenRunSheet.jsx
git commit -m "feat(workout): drive the live session from a database-backed run"
```

---

### Task 9: The exercise screen and the rest timer

**Files:**
- Modify: `src/features/workout/ExerciseDetailScreen.jsx`
- Create: `src/features/workout/RestTimer.jsx`
- Delete: `src/features/workout/LogSetSheet.jsx`

- [ ] **Step 1: Write `RestTimer.jsx`**

Countdown derived from a target timestamp, never accumulated by ticks — the same reasoning as `timer.js`, so a throttled background tab returns showing the right time. Preset from `rest_seconds`, adjustable by ±15s, with start and reset. A speaker `IconButton` toggles the sound and the choice persists in `localStorage` under one key shared by every exercise.

The sound is a short oscillator burst through an `AudioContext` created **in the start handler**, not at module scope: an `AudioContext` constructed without a user gesture starts suspended on iOS and never plays.

Add a comment recording the platform limit honestly: with the screen locked the sound may be late or absent, there is no web API for a scheduled local notification, and the Vibration API does not exist in Safari on iOS. The countdown itself is always correct on return because it is timestamp-derived.

- [ ] **Step 2: Grow the exercise screen**

Keep everything the screen renders today. Add, only when `fetchOpenRun` returns a run whose `session_id` matches this exercise's parent session:

- the sets already logged in this run, as rows of reps × weight
- a log form — the two fields from `LogSetSheet.jsx`, with `target_weight` as the weight placeholder and the reps field autofocused
- `<RestTimer seconds={data.rest_seconds} />`
- a compact top bar showing the session name and the running clock

Per §102, once the count reaches `target_sets` the form is replaced by a plain statement that the exercise is done. Nothing lets a member log a fourth set of three.

Carry over `LogSetSheet.jsx`'s two guards verbatim, both of which exist for real reasons: the `submitted` ref that blocks a double tap without keying off `isPending` (offline a mutation stays pending until reconnect, which would block every set after the first), and the `onMutate`/`onError` pair that bumps and un-bumps the count by a delta rather than restoring a snapshot (two writes in flight, an earlier failure restoring its snapshot would clobber the later one's optimistic state).

Point them at `queryKeys.runLogs(run.id)` instead of `queryKeys.session(sessionId)`.

- [ ] **Step 3: Delete `LogSetSheet.jsx` and its import in `LiveSessionScreen.jsx`**

The live screen's cards now navigate to this route instead of opening a drawer.

- [ ] **Step 4: Lint, build, walk, commit**

```bash
npm run lint && npm run build
git add src/features/workout/ExerciseDetailScreen.jsx src/features/workout/RestTimer.jsx src/features/workout/LiveSessionScreen.jsx
git rm src/features/workout/LogSetSheet.jsx
git commit -m "feat(workout): log sets and rest on the exercise screen"
```

---

### Task 10: The mini-player

**Files:**
- Create: `src/components/LiveSessionBar.jsx`
- Modify: `src/layouts/AppLayout.jsx`

- [ ] **Step 1: Write `LiveSessionBar.jsx`**

Renders props only, per the architecture rule that `components/` neither fetches nor calls Supabase: session name, elapsed time via `formatElapsed`, and a `Link` back to the live route. Sits directly above `BottomNav` and renders nothing when given no run.

- [ ] **Step 2: Mount it**

In `AppLayout.jsx`, add a `useQuery` on `queryKeys.openRun(user.id)` gated on `requiredRole === 'member'`, and render `<LiveSessionBar>` between the `<main>` and `<BottomNav>`. Derive the elapsed value with `elapsedMs` from `timer.js` and a one-second interval that runs only while a run exists and is not paused.

- [ ] **Step 3: Lint, build, walk, commit**

Start a workout, navigate to Home and Nutrition, and confirm the bar follows with a live clock. Reload the app and confirm it is still there.

```bash
npm run lint && npm run build
git add src/components/LiveSessionBar.jsx src/layouts/AppLayout.jsx
git commit -m "feat(workout): keep an open session reachable from every screen"
```

---

### Task 11: The summary, the note, and the coach's side

**Files:**
- Modify: `src/features/workout/SessionSummaryScreen.jsx`
- Modify: `src/features/clients/ClientProgressScreen.jsx`
- Modify: `src/data/progress.js`

- [ ] **Step 1: Summarise the run, not the session**

Take a `runId`, read `fetchRunLogs`, and show `pointsForRun` rather than the flat `pointsForWorkout()`. Say which of the two endings happened: every prescription met, or stopped at N%.

- [ ] **Step 2: Add the note**

A multiline `TextField` and a Save button writing `workout_runs.note` through `endRun`, shown only when the member has a professional. Saving is optional and the screen is usable without it.

- [ ] **Step 3: Surface it to the coach**

Extend `fetchClientTraining` to return recent runs with their outcome, duration and note, and render them in `ClientProgressScreen` as a short list. Without this the note is write-only and the feature is theatre.

- [ ] **Step 4: Lint, build, walk, commit**

```bash
npm run lint && npm run build
git add src/features/workout/SessionSummaryScreen.jsx src/features/clients/ClientProgressScreen.jsx src/data/progress.js
git commit -m "feat(workout): weighted summary, a note for the coach, and somewhere to read it"
```

---

## Final verification

All four self-checks, plus the other five the repo already has:

```bash
node src/features/workout/week.selfcheck.js
node src/features/workout/summary.selfcheck.js
node src/features/workout/status.selfcheck.js
node src/features/workout/timer.selfcheck.js
node src/lib/format.selfcheck.js
node src/theme/resolveTokens.selfcheck.js
node src/features/clients/subscription.selfcheck.js
node src/features/calendar/month.selfcheck.js
node src/features/progress/progress.selfcheck.js
node src/features/profile/pushSubscription.selfcheck.js
```

Then `npm run lint && npm run build && npm run preview`, and the ten-step device walk in the spec's Acceptance section — on a real phone, installed from Safari. Steps 6, 7 and 8 are the three defects Davide found; step 9 is the one this plan's `scope` decision exists to make pass.
