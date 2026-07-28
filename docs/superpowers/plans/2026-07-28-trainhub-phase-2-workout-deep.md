# TrainHub Phase 2 — Workout Deep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a member able to run a workout from start to finish — timer, set logging, pause, stop, summary — with every write surviving a total loss of network, and reward the completed session.

**Architecture:** Reads already flow `data/` → TanStack Query → screen. Writes now flow the same way in reverse: each mutation is registered with `setMutationDefaults` under a stable key so the persister can replay it after a reload, applies an optimistic cache update so the UI never waits on the network, and carries a client-generated UUID so a replayed write is a no-op rather than a duplicate. Pure arithmetic (elapsed time, session volume, points) lives in its own modules with `assert`-based self-checks.

**Tech Stack:** React 19, React Router 8 (data router), MUI v9, TanStack Query v5 with `persistQueryClient`, Supabase JS v2, Vite 8.

## Global Constraints

- Plain JS + JSX. **No TypeScript**, no `.ts`/`.tsx` files.
- ESM only (`"type": "module"`). No `require`.
- **No new runtime dependencies.** Everything needed is already in `package.json`. If a task seems to need one, stop and report instead.
- All user-facing copy in **English**.
- MUI components and the theme in `src/theme/index.js` carry all styling. No CSS files, no inline colour literals — use `palette.*`, including the custom `palette.task.*` group.
- No test runner exists and none is added. Non-trivial pure logic ships an `assert`-based `*.selfcheck.js` run with `node <path>`, following `src/lib/format.selfcheck.js`.
- `npm run lint` must exit 0 at the end of every task.
- Commits: Conventional Commits, **no `Co-Authored-By` trailer** — the repository history is Davide's alone.
- Every screen renders sanely while loading, on error, and when empty. A blank screen is a bug.
- **Reads gate their error state on `data === undefined`, never on `isError`.** With `networkMode: 'offlineFirst'` a failed refetch leaves good cached data in place, and an error screen instead of that data is wrong for this app. Every Phase 1 screen already does this; match it.
- Every Supabase read carries `.retry(navigator.onLine)`. postgrest retries a failed GET three times with 1s/2s/4s backoff, which turns "offline" into seven seconds of nothing.
- Row Level Security governs every write. A client-side filter is not a security measure; it only narrows a legitimately broader statement.

---

## What already exists

Do not rebuild these.

| Path | What it gives you |
|---|---|
| `src/data/workouts.js` | `fetchActivePlan`, `fetchSession`, `fetchSessionExercise` |
| `src/data/appointments.js` | `fetchAppointmentsOnDay` |
| `src/lib/queryKeys.js` | `activePlan`, `session`, `sessionExercise`, `appointmentsOnDay` |
| `src/lib/format.js` | `formatTimeRange`, `formatDate`, `todayISO` |
| `src/features/workout/status.js` | `sessionStatusOf`, `setProgress`, `planProgress` |
| `src/components/ScreenState.jsx` | `LoadingState`, `ErrorState`, `EmptyState` |
| `src/components/SessionCard.jsx`, `AppointmentCard.jsx` | shared rows |
| `src/lib/queryClient.js` | `queryClient`, `persister`, `CACHE_MAX_AGE`; mutations already default to `networkMode: 'offlineFirst'`, `retry: 3` |
| `src/features/auth/useAuth.js` | `useAuth()` → `{session, user, profile, profileError, loading, signOut}` |

Routes already declared as placeholders and waiting for real screens:
`/m/workout/session/:sessionId/live`, `/m/workout/session/:sessionId/summary`, `/m/workout/builder`, `/m/profile/rewards`.

Relevant schema facts (from `supabase/schema.sql`, do not re-derive):

- `set_logs.id` is `uuid primary key` **with no default** — the client supplies it. That is the idempotency key that makes a replayed write safe.
- `set_logs` columns: `id, session_exercise_id, member_id, set_number, reps, weight, performed_at`.
- `workout_sessions.status` is the enum `session_status` = `'todo' | 'in_progress' | 'completed'`.
- `rewards` has `unique (member_id, code)` — a per-event code makes an award idempotent.
- RLS permits a member to write their own `set_logs`, `workout_sessions`, `session_exercises`, `workout_plans` and to **insert** `rewards`. A member may **not** write `exercises` — the builder picks from the catalogue only.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/features/workout/timer.js` | Pure elapsed/pause/resume arithmetic |
| `src/features/workout/timer.selfcheck.js` | Assertions for the above |
| `src/features/workout/summary.js` | Pure session volume and points arithmetic |
| `src/features/workout/summary.selfcheck.js` | Assertions for the above |
| `src/lib/mutationKeys.js` | Every mutation key in one place |
| `src/data/mutations.js` | `registerMutationDefaults(queryClient)` — the replay contract |
| `src/features/workout/useLiveSession.js` | Timer state persisted across reloads |
| `src/features/workout/LiveSessionScreen.jsx` | `/m/workout/session/:sessionId/live` |
| `src/features/workout/LogSetSheet.jsx` | Bottom sheet that records one set |
| `src/features/workout/SessionSummaryScreen.jsx` | `/m/workout/session/:sessionId/summary` |
| `src/features/workout/WorkoutBuilderScreen.jsx` | `/m/workout/builder` |
| `src/features/rewards/RewardsScreen.jsx` | `/m/profile/rewards` |
| `src/data/rewards.js` | Reward reads and the award write |
| `src/components/OfflineBanner.jsx` | Persistent "offline — changes will sync" strip |
| `supabase/patches/003-award-points-server-side.sql` | Trigger deriving `rewards.points` from `code` |

**Modified:**

| Path | Change |
|---|---|
| `src/data/workouts.js` | Add `logSet`, `startSession`, `completeSession`, `fetchSessionLogs` |
| `src/lib/queryKeys.js` | Add `sessionLogs`, `rewards` |
| `src/App.jsx` | Call `registerMutationDefaults` before the provider mounts |
| `src/layouts/AppLayout.jsx` | Render `OfflineBanner` above the outlet |
| `src/routes/index.jsx` | Wire four real screens, lazily |

---

## Task 1: Session timer arithmetic

**Files:**
- Create: `src/features/workout/timer.js`
- Create: `src/features/workout/timer.selfcheck.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `startTimer(now) -> {startedAt, pausedAt: null, pausedTotal: 0}`
  - `pauseTimer(state, now) -> state` (no-op if already paused)
  - `resumeTimer(state, now) -> state` (no-op if running)
  - `elapsedMs(state, now) -> number` — never negative
  - `formatElapsed(ms) -> string` — `'00:07:20'`, always `hh:mm:ss`
  - `isPaused(state) -> boolean`

A running clock cannot be `setInterval` arithmetic: a phone locks mid-set, the tab is throttled, and the accumulated count drifts or stops. Store timestamps and derive elapsed from `Date.now()`; the interval exists only to trigger a re-render.

- [ ] **Step 1: Write the failing self-check**

Create `src/features/workout/timer.selfcheck.js`:

```js
// Run with:  node src/features/workout/timer.selfcheck.js
import assert from 'node:assert/strict'
import { elapsedMs, formatElapsed, isPaused, pauseTimer, resumeTimer, startTimer } from './timer.js'

const T0 = 1_000_000

const started = startTimer(T0)
assert.deepEqual(started, { startedAt: T0, pausedAt: null, pausedTotal: 0 })
assert.equal(isPaused(started), false)
assert.equal(elapsedMs(started, T0), 0)
assert.equal(elapsedMs(started, T0 + 5000), 5000)

// Pausing freezes the clock: elapsed must not advance while paused.
const paused = pauseTimer(started, T0 + 5000)
assert.equal(isPaused(paused), true)
assert.equal(elapsedMs(paused, T0 + 5000), 5000)
assert.equal(elapsedMs(paused, T0 + 60_000), 5000)

// Resuming does not credit the paused stretch.
const resumed = resumeTimer(paused, T0 + 60_000)
assert.equal(isPaused(resumed), false)
assert.equal(elapsedMs(resumed, T0 + 60_000), 5000)
assert.equal(elapsedMs(resumed, T0 + 61_000), 6000)

// Two pause/resume cycles accumulate, they do not overwrite each other.
const paused2 = pauseTimer(resumed, T0 + 61_000)
const resumed2 = resumeTimer(paused2, T0 + 100_000)
assert.equal(elapsedMs(resumed2, T0 + 101_000), 7000)

// Double pause and double resume must be no-ops, not corruption -- a double tap
// on a phone is one event too many, not a reason to lose the workout.
assert.deepEqual(pauseTimer(paused, T0 + 99_999), paused)
assert.deepEqual(resumeTimer(resumed, T0 + 99_999), resumed)

// A clock that went backwards (device time corrected mid-session) must read 0,
// never a negative duration rendered as "-00:00:04".
assert.equal(elapsedMs(started, T0 - 4000), 0)

assert.equal(formatElapsed(0), '00:00:00')
assert.equal(formatElapsed(7000), '00:00:07')
assert.equal(formatElapsed(440_000), '00:07:20')
assert.equal(formatElapsed(3_661_000), '01:01:01')
// Over a day still reads as hours rather than wrapping to zero.
assert.equal(formatElapsed(90_000_000), '25:00:00')

console.log('timer: OK')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node src/features/workout/timer.selfcheck.js`
Expected: FAIL — `Cannot find module ... timer.js`

- [ ] **Step 3: Write the implementation**

Create `src/features/workout/timer.js`:

```js
// Elapsed time as arithmetic over timestamps, not an accumulating counter.
// A counter driven by setInterval drifts, and stops entirely when the phone
// locks or the browser throttles a background tab -- which is precisely what
// happens during a set.  Storing when things happened and subtracting is
// immune to all of it.  No imports, so the self-check runs under bare Node.

/** A fresh, running timer. */
export function startTimer(now) {
  return { startedAt: now, pausedAt: null, pausedTotal: 0 }
}

export function isPaused(state) {
  return state.pausedAt !== null
}

/** Freeze the clock. Already paused is a no-op, not a second pause. */
export function pauseTimer(state, now) {
  if (isPaused(state)) return state
  return { ...state, pausedAt: now }
}

/** Resume, crediting the paused stretch to `pausedTotal` rather than losing it. */
export function resumeTimer(state, now) {
  if (!isPaused(state)) return state
  return {
    ...state,
    pausedAt: null,
    pausedTotal: state.pausedTotal + (now - state.pausedAt),
  }
}

/**
 * Wall-clock time since the start, minus everything spent paused.
 *
 * Clamped at zero: a device whose clock is corrected backwards mid-session
 * would otherwise render a negative duration, and "-00:00:04" in the middle of
 * a workout looks like the app has broken.
 */
export function elapsedMs(state, now) {
  const upTo = isPaused(state) ? state.pausedAt : now
  return Math.max(0, upTo - state.startedAt - state.pausedTotal)
}

/** `'00:07:20'`. Hours are not wrapped -- a forgotten session reads 25:00:00. */
export function formatElapsed(ms) {
  const total = Math.floor(ms / 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return [pad(Math.floor(total / 3600)), pad(Math.floor(total / 60) % 60), pad(total % 60)].join(':')
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `node src/features/workout/timer.selfcheck.js`
Expected: `timer: OK`

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/timer.js src/features/workout/timer.selfcheck.js
git commit -m "feat: add session timer arithmetic"
```

---

## Task 2: Session summary arithmetic

**Files:**
- Create: `src/features/workout/summary.js`
- Create: `src/features/workout/summary.selfcheck.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `summariseSession(exercises, logs) -> {exerciseCount, completedCount, setCount, totalReps, volumeKg, allComplete}`
    - `exercises`: `[{id, target_sets}]` (a `session_exercises` row)
    - `logs`: `[{session_exercise_id, reps, weight}]`
  - `POINTS` — `{checkin: 10, workout: 30, referral: 60}`
  - `pointsForWorkout() -> number`
  - `rewardProgress(totalPoints, rewards) -> {total, next, remaining, percent}`

`volumeKg` is the standard training measure: reps × weight, summed. A set logged with no weight (bodyweight) contributes reps but no volume.

- [ ] **Step 1: Write the failing self-check**

Create `src/features/workout/summary.selfcheck.js`:

```js
// Run with:  node src/features/workout/summary.selfcheck.js
import assert from 'node:assert/strict'
import { POINTS, pointsForWorkout, rewardProgress, summariseSession } from './summary.js'

const exercises = [
  { id: 'a', target_sets: 3 },
  { id: 'b', target_sets: 2 },
]

assert.deepEqual(summariseSession([], []), {
  exerciseCount: 0,
  completedCount: 0,
  setCount: 0,
  totalReps: 0,
  volumeKg: 0,
  allComplete: false,
})

assert.deepEqual(
  summariseSession(exercises, [
    { session_exercise_id: 'a', reps: 10, weight: 60 },
    { session_exercise_id: 'a', reps: 8, weight: 60 },
    { session_exercise_id: 'a', reps: 8, weight: 60 },
    { session_exercise_id: 'b', reps: 12, weight: null },
  ]),
  {
    exerciseCount: 2,
    completedCount: 1,
    setCount: 4,
    totalReps: 38,
    // 10*60 + 8*60 + 8*60 = 1560.  The bodyweight set adds reps, not volume.
    volumeKg: 1560,
    allComplete: false,
  },
)

// Every prescription met.
assert.equal(
  summariseSession(exercises, [
    { session_exercise_id: 'a', reps: 1, weight: 1 },
    { session_exercise_id: 'a', reps: 1, weight: 1 },
    { session_exercise_id: 'a', reps: 1, weight: 1 },
    { session_exercise_id: 'b', reps: 1, weight: 1 },
    { session_exercise_id: 'b', reps: 1, weight: 1 },
  ]).allComplete,
  true,
)

// Logs pointing at an exercise no longer in the session must not crash or
// inflate completedCount -- a trainer can remove an exercise after it was
// logged, and the cascade only fires on delete of the parent row.
assert.equal(
  summariseSession(exercises, [{ session_exercise_id: 'gone', reps: 5, weight: 20 }]).completedCount,
  0,
)

// Fractional plate weights must not accumulate float noise into the display.
assert.equal(
  summariseSession([{ id: 'a', target_sets: 1 }], [{ session_exercise_id: 'a', reps: 3, weight: 2.5 }])
    .volumeKg,
  7.5,
)

assert.deepEqual(POINTS, { checkin: 10, workout: 30, referral: 60 })
assert.equal(pointsForWorkout(), 30)

assert.deepEqual(rewardProgress(1020, [{ points: 1000 }, { points: 1100 }]), {
  total: 1020,
  next: 1100,
  remaining: 80,
  percent: 92,
})
// Nothing left to earn: no next reward, nothing remaining, bar full.
assert.deepEqual(rewardProgress(1200, [{ points: 1000 }]), {
  total: 1200,
  next: null,
  remaining: 0,
  percent: 100,
})
// No rewards defined at all must not divide by zero.
assert.deepEqual(rewardProgress(0, []), { total: 0, next: null, remaining: 0, percent: 100 })

console.log('summary: OK')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node src/features/workout/summary.selfcheck.js`
Expected: FAIL — `Cannot find module ... summary.js`

- [ ] **Step 3: Write the implementation**

Create `src/features/workout/summary.js`:

```js
// Pure arithmetic for the post-session summary and the rewards screen.
// No imports, so the self-check runs under bare Node.

/** The points table the Rewards screen also prints for the member. */
export const POINTS = { checkin: 10, workout: 30, referral: 60 }

export function pointsForWorkout() {
  return POINTS.workout
}

/**
 * Roll one session's logs up into the numbers the summary shows.
 *
 * `volumeKg` is reps x weight summed -- the usual training measure. A set with
 * no weight is a bodyweight set: it counts towards reps and set count but
 * contributes no volume, which is right, not a gap.
 */
export function summariseSession(exercises, logs) {
  const perExercise = new Map(exercises.map((exercise) => [exercise.id, 0]))

  let setCount = 0
  let totalReps = 0
  let volume = 0

  for (const log of logs) {
    setCount += 1
    totalReps += log.reps ?? 0
    volume += (log.reps ?? 0) * (log.weight ?? 0)

    // A log can outlive the exercise it belongs to only if the row was edited
    // rather than deleted, but guarding costs one branch and a crash here would
    // take down the screen that celebrates the workout.
    if (perExercise.has(log.session_exercise_id)) {
      perExercise.set(log.session_exercise_id, perExercise.get(log.session_exercise_id) + 1)
    }
  }

  const completedCount = exercises.filter(
    (exercise) => perExercise.get(exercise.id) >= exercise.target_sets,
  ).length

  return {
    exerciseCount: exercises.length,
    completedCount,
    setCount,
    totalReps,
    // Two decimals: 2.5 kg plates are real, and float addition otherwise
    // surfaces 1559.9999999999998 on a summary screen.
    volumeKg: Math.round(volume * 100) / 100,
    allComplete: exercises.length > 0 && completedCount === exercises.length,
  }
}

/**
 * Where the member stands against the next reward they have not yet earned.
 *
 * `rewards` is the catalogue of what can be claimed, each with a `points` cost.
 */
export function rewardProgress(totalPoints, rewards) {
  const costs = rewards.map((reward) => reward.points).sort((a, b) => a - b)
  const next = costs.find((cost) => cost > totalPoints) ?? null

  // Nothing further to reach for is a full bar, not an empty one -- and it
  // avoids dividing by a `next` that does not exist.
  if (next === null) return { total: totalPoints, next: null, remaining: 0, percent: 100 }

  return {
    total: totalPoints,
    next,
    remaining: next - totalPoints,
    percent: Math.round((totalPoints / next) * 100),
  }
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `node src/features/workout/summary.selfcheck.js`
Expected: `summary: OK`

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/summary.js src/features/workout/summary.selfcheck.js
git commit -m "feat: add session summary and reward progress arithmetic"
```

---

## Task 3: Workout write layer

**Files:**
- Modify: `src/data/workouts.js` (append; do not alter the existing reads)
- Modify: `src/lib/queryKeys.js`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js`.
- Produces:
  - `fetchSessionLogs(sessionId) -> Promise<Array<{id, session_exercise_id, set_number, reps, weight, performed_at}>>`
  - `logSet({id, sessionExerciseId, memberId, setNumber, reps, weight, performedAt}) -> Promise<row | null>`
  - `setSessionStatus({sessionId, status}) -> Promise<row>`
  - `queryKeys.sessionLogs(sessionId) -> ['sessionLogs', sessionId]`
  - `queryKeys.rewards(memberId) -> ['rewards', memberId]`

**Everything here must be safe to run twice.** A paused mutation is replayed by `resumePausedMutations()`, and the network can die *after* a write lands but before its response arrives — so replay is not an edge case, it is the normal failure mode this app is built around.

- [ ] **Step 1: Add the two query keys**

In `src/lib/queryKeys.js`, add these two entries to the exported object, keeping the existing ones untouched:

```js
  sessionLogs: (sessionId) => ['sessionLogs', sessionId],
  rewards: (memberId) => ['rewards', memberId],
```

- [ ] **Step 2: Append the write layer to `src/data/workouts.js`**

Add at the end of the file:

```js
/** Every set the member has logged in one session. */
export async function fetchSessionLogs(sessionId) {
  const { data, error } = await supabase
    .from('set_logs')
    // `!inner` turns the embed into an inner join, which is what lets the filter
    // below reach through to the parent session.  RLS still scopes the rows to
    // this member on top of it.
    .select(
      'id, session_exercise_id, set_number, reps, weight, performed_at, session_exercises!inner ( session_id )',
    )
    .eq('session_exercises.session_id', sessionId)
    .order('performed_at')
    .retry(navigator.onLine)

  if (error) throw error
  // Drop the join row the filter needed; no screen should have to see it.
  return (data ?? []).map(({ session_exercises: _join, ...log }) => log)
}

/**
 * Record one performed set.
 *
 * The caller supplies `id`.  `set_logs.id` has no database default precisely so
 * this can be an upsert that ignores duplicates: `resumePausedMutations` will
 * replay a write whose response never arrived, and a plain insert would fail
 * that replay with a primary-key violation the user would see as a lost set.
 */
export async function logSet({ id, sessionExerciseId, memberId, setNumber, reps, weight }) {
  const { data, error } = await supabase
    .from('set_logs')
    .upsert(
      {
        id,
        session_exercise_id: sessionExerciseId,
        member_id: memberId,
        set_number: setNumber,
        reps,
        weight: weight ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success, not a gap.
  return data
}

/**
 * Move a session between `todo`, `in_progress` and `completed`.
 *
 * Idempotent by nature: setting a status it already holds writes the same value.
 */
export async function setSessionStatus({ sessionId, status }) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .update({ status })
    .eq('id', sessionId)
    .select('id, status')
    .single()

  if (error) throw error
  return data
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Verify the embedded filter against the real database**

`fetchSessionLogs` uses an inner join to filter by the parent session, which only fails at runtime. Run the dev server and, in the browser console:

```js
const { supabase } = await import('/src/lib/supabase.js')
await supabase.auth.signInWithPassword({
  email: 'daniel@trainhub.dev',
  password: 'TrainHub2026!',
})
const { fetchActivePlan, fetchSessionLogs } = await import('/src/data/workouts.js')
const { data: { user } } = await supabase.auth.getUser()
const { sessions } = await fetchActivePlan(user.id)
console.log(await fetchSessionLogs(sessions[0].id))
```

Expected: `[]` — the seed logs no sets. An error mentioning `session_exercises` means the embed hint is wrong; read the relationship names with `\d set_logs` in the SQL editor and correct it.

- [ ] **Step 5: Commit**

```bash
git add src/data/workouts.js src/lib/queryKeys.js
git commit -m "feat: add idempotent workout write layer"
```

---

## Task 4: Offline-replayable mutation registration

**Files:**
- Create: `src/lib/mutationKeys.js`
- Create: `src/data/mutations.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `logSet`, `setSessionStatus` from `src/data/workouts.js`; `queryKeys`.
- Produces:
  - `mutationKeys.logSet` — `['logSet']`
  - `mutationKeys.setSessionStatus` — `['setSessionStatus']`
  - `registerMutationDefaults(queryClient) -> void`

**This is the load-bearing task of the phase.** A persisted mutation stores only its key and variables — a function cannot be serialised. On rehydration TanStack Query looks the function back up by key through `setMutationDefaults`. Register nothing, and every write made offline is replayed with no `mutationFn` and thrown away silently. The member's whole workout disappears on reload, and nothing in the console says why.

- [ ] **Step 1: Write the mutation keys**

Create `src/lib/mutationKeys.js`:

```js
// Mutation keys are not merely cache bookkeeping like query keys: the persister
// stores a paused mutation BY KEY and, after a reload, finds its function again
// through `setMutationDefaults(key, ...)`.  A key that drifts between the
// registration and the call site produces a mutation with no function, which is
// discarded without an error.  One home for both halves.
export const mutationKeys = {
  logSet: ['logSet'],
  setSessionStatus: ['setSessionStatus'],
}
```

- [ ] **Step 2: Write the registration**

Create `src/data/mutations.js`:

```js
import { logSet, setSessionStatus } from './workouts.js'
import { mutationKeys } from '../lib/mutationKeys.js'
import { queryKeys } from '../lib/queryKeys.js'

/**
 * Teach the query client how to replay each mutation after a reload.
 *
 * Must run BEFORE `PersistQueryClientProvider` restores the cache: restoration
 * resumes paused mutations, and one resumed before its default is registered
 * has no function to call.  `src/App.jsx` calls this at module scope for that
 * reason -- not inside an effect, which would run too late.
 */
export function registerMutationDefaults(queryClient) {
  queryClient.setMutationDefaults(mutationKeys.logSet, {
    mutationFn: logSet,
    // Only the session's own caches are affected, and the summary reads the
    // same logs -- invalidating both keeps them from disagreeing.
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionLogs(variables.sessionId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.session(variables.sessionId) })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.setSessionStatus, {
    mutationFn: setSessionStatus,
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.session(variables.sessionId) })
      // The plan screen and Home both render this session's status.
      queryClient.invalidateQueries({ queryKey: ['plan'] })
    },
  })
}
```

Note: `logSet` in `src/data/workouts.js` ignores any extra property on its argument, so passing `sessionId` alongside is safe and gives `onSettled` the key it needs to invalidate.

- [ ] **Step 3: Wire it into `src/App.jsx`**

Add the import beside the existing ones:

```js
import { registerMutationDefaults } from './data/mutations.js'
```

and call it at module scope, immediately after the imports and before `export default function App()`:

```js
// At module scope, not in an effect: `PersistQueryClientProvider` restores the
// cache and resumes paused mutations as it mounts, which is before any effect
// runs.  A mutation resumed without its default has no function and is dropped.
registerMutationDefaults(queryClient)
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mutationKeys.js src/data/mutations.js src/App.jsx
git commit -m "feat: register mutation defaults so offline writes survive a reload"
```

---

## Task 5: Sync status — offline banner and failed writes

**Files:**
- Create: `src/components/OfflineBanner.jsx`
- Modify: `src/layouts/AppLayout.jsx`

**Interfaces:**
- Consumes: `useMutationState` from `@tanstack/react-query` (already installed).
- Produces: `<OfflineBanner />`, default export.

The design spec calls offline "a first-class state, not an error", with a persistent indicator telling the member their changes will sync. Without it, logging sets in a basement looks identical to logging them into nothing.

The same component also has to report the opposite case. `LogSetSheet` rolls its optimistic count back when a write genuinely fails, and a set that silently disappears from the screen is the worst failure this app can have — worse than an error message, because the member believes the work was recorded. The spec asks for mutation errors as snackbars; this is that, kept in one place rather than repeated per screen.

- [ ] **Step 1: Write the component**

Create `src/components/OfflineBanner.jsx`:

```js
import { useEffect, useState } from 'react'
import { Alert, Box, Snackbar, Typography } from '@mui/material'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import { useMutationState } from '@tanstack/react-query'

const plural = (n) => (n === 1 ? '' : 's')

export default function OfflineBanner() {
  // `navigator.onLine` is a starting value, not a subscription -- the events are
  // what actually tell us, so both are needed.
  const [online, setOnline] = useState(() => navigator.onLine)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Only PAUSED mutations count as "waiting to sync".  Filtering on `pending`
  // alone would also catch every ordinary in-flight write and flash the banner
  // for a few hundred milliseconds on each one.
  const waiting = useMutationState({
    filters: { status: 'pending' },
    select: (mutation) => mutation.state.isPaused,
  }).filter(Boolean).length

  // A write that genuinely failed -- not one merely waiting for a network.
  // `LogSetSheet` rolls its optimistic count back on error, so without this the
  // set simply vanishes and the member believes it was recorded.
  const failed = useMutationState({
    filters: { status: 'error' },
    select: (mutation) => mutation.mutationId,
  }).length

  const banner =
    !online || waiting > 0 ? (
      <Box
        role="status"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          py: 0.75,
          px: 2,
          bgcolor: 'task.suspended',
          color: 'text.primary',
        }}
      >
        <CloudOffIcon fontSize="small" aria-hidden />
        <Typography variant="body2">
          {online
            ? `Syncing ${waiting} change${plural(waiting)}…`
            : waiting > 0
              ? `Offline — ${waiting} change${plural(waiting)} will sync when you reconnect`
              : 'Offline — your workout still works'}
        </Typography>
      </Box>
    ) : null

  return (
    <>
      {banner}
      <Snackbar
        open={failed > 0 && !dismissed}
        onClose={() => setDismissed(true)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        // No auto-hide: a lost set is worth an explicit dismissal.
        sx={{ bottom: { xs: 72 } }}
      >
        <Alert severity="error" onClose={() => setDismissed(true)}>
          {failed} change{plural(failed)} could not be saved. Try again.
        </Alert>
      </Snackbar>
    </>
  )
}
```

- [ ] **Step 2: Render it in `src/layouts/AppLayout.jsx`**

Add the import beside the existing component imports:

```js
import OfflineBanner from '../components/OfflineBanner.jsx'
```

In the final `return`, insert it between `<TopHeader ... />` and the `<Box component="main" ...>`:

```jsx
      <TopHeader profileHref={profileHref} />
      <OfflineBanner />
      <Box component="main" sx={{ flexGrow: 1, pb: 2 }}>
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, sign in, then in DevTools → Network set Offline.

| Check | Expected |
|---|---|
| The banner appears under the header | "Offline — your workout still works" |
| Back online | the banner disappears |
| It does not cover content | the screen scrolls normally beneath it |
| Online, with no pending writes | nothing renders, and no banner flashes during an ordinary write |

- [ ] **Step 5: Commit**

```bash
git add src/components/OfflineBanner.jsx src/layouts/AppLayout.jsx
git commit -m "feat: show sync status for offline and failed writes"
```

---

## Task 6: Log-set sheet

**Files:**
- Create: `src/features/workout/LogSetSheet.jsx`

**Interfaces:**
- Consumes: `mutationKeys`, `queryKeys`, `useAuth`, `setProgress` from `src/features/workout/status.js`.
- Produces: `<LogSetSheet open onClose exercise sessionId />`, default export.
  - `exercise` is one entry of `fetchSession`'s `exercises` array.

The optimistic update is the point. Offline, the mutation pauses and returns nothing for minutes — without writing the new count into the cache immediately, tapping "Log set" appears to do nothing and the member logs it twice.

- [ ] **Step 1: Write the sheet**

Create `src/features/workout/LogSetSheet.jsx`:

```js
import { useState } from 'react'
import { Box, Button, Drawer, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { setProgress } from './status.js'
import { useAuth } from '../auth/useAuth.js'

export default function LogSetSheet({ open, onClose, exercise, sessionId }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const progress = setProgress(exercise?.loggedCount, exercise?.target_sets)
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')

  const logSet = useMutation({
    // No `mutationFn` here on purpose: it is registered against this key in
    // `src/data/mutations.js`, which is also where a mutation restored from
    // IndexedDB after a reload finds it again.  Declaring it here too would
    // create a second source of truth that the persister cannot see.
    mutationKey: mutationKeys.logSet,

    onMutate: async (variables) => {
      // Offline this mutation pauses and settles minutes later.  Writing the
      // new count now is what makes the "2/3" pill move the moment the button
      // is tapped -- otherwise nothing happens and the set gets logged twice.
      await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })
      const previous = queryClient.getQueryData(queryKeys.session(sessionId))

      queryClient.setQueryData(queryKeys.session(sessionId), (current) =>
        current
          ? {
              ...current,
              exercises: current.exercises.map((item) =>
                item.id === variables.sessionExerciseId
                  ? { ...item, loggedCount: item.loggedCount + 1 }
                  : item,
              ),
            }
          : current,
      )

      return { previous }
    },

    onError: (_error, _variables, context) => {
      // Put the count back only if we have something to put back.
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.session(sessionId), context.previous)
      }
    },
  })

  const onSubmit = (event) => {
    event.preventDefault()

    logSet.mutate({
      // The client owns this id so a replayed write upserts instead of
      // duplicating.  `crypto.randomUUID` needs a secure context: HTTPS or
      // localhost, which is every way this app is served.
      id: crypto.randomUUID(),
      sessionExerciseId: exercise.id,
      sessionId,
      memberId: user.id,
      setNumber: progress.done + 1,
      reps: Number(reps),
      weight: weight === '' ? null : Number(weight),
      // Stamped here, not by the database default.  This write may sit paused
      // for hours and be replayed on reconnect; `now()` at insert time would
      // record a set performed at 18:00 as happening at 23:00.
      performedAt: new Date().toISOString(),
    })

    setReps('')
    setWeight('')
    onClose()
  }

  if (!exercise) return null

  return (
    <Drawer anchor="bottom" open={open} onClose={onClose}>
      <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ p: 3 }}>
        <Box>
          <Typography variant="h2" component="h2">
            {exercise.exercise.name}
          </Typography>
          <Typography color="text.secondary">
            Set {progress.done + 1} of {exercise.target_sets} • target {exercise.target_reps} reps
          </Typography>
        </Box>

        <Stack direction="row" spacing={2}>
          <TextField
            label="Reps"
            type="number"
            value={reps}
            onChange={(event) => setReps(event.target.value)}
            // `inputMode` is what actually summons the numeric keypad on a
            // phone; type="number" alone gives a full keyboard on some Androids.
            slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 999 } }}
            placeholder={String(exercise.target_reps)}
            required
            fullWidth
            autoFocus
          />
          <TextField
            label="Weight (kg)"
            type="number"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal', step: 0.5, min: 0, max: 999 } }}
            placeholder={exercise.target_weight ? String(exercise.target_weight) : 'Bodyweight'}
            fullWidth
          />
        </Stack>

        <Button type="submit" variant="contained" size="large" fullWidth>
          Log set
        </Button>
      </Stack>
    </Drawer>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/workout/LogSetSheet.jsx
git commit -m "feat: add the log-set sheet with an optimistic count"
```

---

## Task 7: Live session screen

**Files:**
- Create: `src/features/workout/useLiveSession.js`
- Create: `src/features/workout/LiveSessionScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `timer.js`, `fetchSession`, `queryKeys`, `mutationKeys`, `setProgress`, `LogSetSheet`, screen states.
- Produces: nothing other modules import.

Matches `doc/assets/gym_member/06 - Session.png`, `06A - Session Started.png` and `06B - Session Paused.png`: a sticky header with the session name, exercise count, "GET READY" / "N/N to go" / "PAUSED", a clock, and play or pause+stop controls. Below it the exercise list, with the current exercise outlined in the primary colour and finished ones dimmed with a green tick (`doc/assets/components/Exercise/Card.png`).

- [ ] **Step 1: Write the timer hook**

Create `src/features/workout/useLiveSession.js`:

```js
import { useCallback, useEffect, useState } from 'react'
import { elapsedMs, isPaused, pauseTimer, resumeTimer, startTimer } from './timer.js'

const storageKey = (sessionId) => `trainhub-live-${sessionId}`

function readStored(sessionId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(sessionId)))
  } catch {
    return null
  }
}

/**
 * A live session's clock, surviving a reload.
 *
 * The state is three timestamps, persisted on every change: a phone that locks,
 * a tab the browser evicts, or a member who reloads mid-workout must all come
 * back to the same running clock rather than to zero.
 */
export function useLiveSession(sessionId) {
  const [state, setState] = useState(() => readStored(sessionId))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (state) {
      localStorage.setItem(storageKey(sessionId), JSON.stringify(state))
    } else {
      localStorage.removeItem(storageKey(sessionId))
    }
  }, [sessionId, state])

  useEffect(() => {
    // The interval only forces a re-render; the elapsed value is derived from
    // timestamps, so a tick the browser skips while throttled costs nothing.
    if (!state || isPaused(state)) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state])

  const start = useCallback(() => setState(startTimer(Date.now())), [])
  const pause = useCallback(() => setState((prev) => (prev ? pauseTimer(prev, Date.now()) : prev)), [])
  const resume = useCallback(
    () => setState((prev) => (prev ? resumeTimer(prev, Date.now()) : prev)),
    [],
  )
  const clear = useCallback(() => setState(null), [])

  return {
    started: state !== null,
    paused: state !== null && isPaused(state),
    elapsed: state ? elapsedMs(state, now) : 0,
    start,
    pause,
    resume,
    clear,
  }
}
```

- [ ] **Step 2: Write the screen**

Create `src/features/workout/LiveSessionScreen.jsx`:

```js
import { useState } from 'react'
import {
  Box, Card, CardActionArea, CardContent, Chip, IconButton, Stack, Typography,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import StopIcon from '@mui/icons-material/Stop'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { fetchSession } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { formatElapsed } from './timer.js'
import { setProgress } from './status.js'
import { useLiveSession } from './useLiveSession.js'
import LogSetSheet from './LogSetSheet.jsx'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

export default function LiveSessionScreen() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const live = useLiveSession(sessionId)
  const [openExerciseId, setOpenExerciseId] = useState(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  const setStatus = useMutation({ mutationKey: mutationKeys.setSessionStatus })

  if (isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the session, and an error
  // screen instead of the workout is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const { session, exercises } = data
  const remaining = exercises.filter(
    (item) => !setProgress(item.loggedCount, item.target_sets).complete,
  ).length
  const openExercise = exercises.find((item) => item.id === openExerciseId) ?? null
  // The first unfinished exercise is the one being worked on.
  const currentId = exercises.find(
    (item) => !setProgress(item.loggedCount, item.target_sets).complete,
  )?.id

  const onStart = () => {
    live.start()
    setStatus.mutate({ sessionId, status: 'in_progress' })
  }

  const onStop = () => {
    setStatus.mutate({ sessionId, status: 'completed' })
    live.clear()
    navigate(`/m/workout/session/${sessionId}/summary`, { replace: true })
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Card sx={{ position: 'sticky', top: 0, zIndex: 1 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton
              component={Link}
              to={`/m/workout/session/${sessionId}`}
              aria-label="Back to session"
              edge="start"
            >
              <ArrowBackIosNewIcon fontSize="small" />
            </IconButton>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" component="h1" noWrap>
                {session.name}
              </Typography>
              <Typography color="text.secondary">{exercises.length} exercises</Typography>
              <Typography color="primary" sx={{ fontWeight: 700 }}>
                {!live.started ? 'GET READY' : live.paused ? 'PAUSED' : `${remaining}/${exercises.length} to go`}
              </Typography>
            </Box>

            <Stack direction="row" spacing={0.5} alignItems="center">
              {!live.started ? (
                <IconButton onClick={onStart} aria-label="Start session" color="primary" size="large">
                  <PlayArrowIcon fontSize="large" />
                </IconButton>
              ) : (
                <>
                  <IconButton
                    onClick={live.paused ? live.resume : live.pause}
                    aria-label={live.paused ? 'Resume session' : 'Pause session'}
                    color="primary"
                  >
                    {live.paused ? <PlayArrowIcon /> : <PauseIcon />}
                  </IconButton>
                  <IconButton onClick={onStop} aria-label="Finish session" color="primary">
                    <StopIcon />
                  </IconButton>
                </>
              )}
            </Stack>
          </Stack>

          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ justifyContent: 'flex-end' }}>
            <AccessTimeIcon fontSize="small" color="primary" aria-hidden />
            {/* aria-live so the clock is available on demand without a screen
                reader announcing every single second. */}
            <Typography aria-live="off" aria-label={`Elapsed ${formatElapsed(live.elapsed)}`}>
              {formatElapsed(live.elapsed)}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Exercises
        </Typography>

        <Stack spacing={2}>
          {exercises.map((item) => {
            const progress = setProgress(item.loggedCount, item.target_sets)
            const isCurrent = item.id === currentId && live.started && !live.paused

            return (
              <Card
                key={item.id}
                sx={{
                  // The wireframe outlines the exercise in progress and fades
                  // the finished ones.  Opacity alone would carry that by sight
                  // only, so the tick and the pill say it too.
                  borderColor: isCurrent ? 'primary.main' : 'divider',
                  borderWidth: isCurrent ? 2 : 1,
                  opacity: progress.complete ? 0.6 : 1,
                }}
              >
                <CardActionArea
                  onClick={() => setOpenExerciseId(item.id)}
                  disabled={!live.started || live.paused}
                >
                  <CardContent>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h3" noWrap>
                          {item.exercise.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {item.exercise.muscle_group}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {item.target_sets} sets • {item.target_reps} reps
                        </Typography>
                      </Box>

                      {progress.complete ? (
                        <CheckCircleIcon color="success" titleAccess="Completed" />
                      ) : (
                        <Chip label={progress.label} size="small" color="primary" />
                      )}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            )
          })}
        </Stack>
      </Box>

      <LogSetSheet
        open={openExercise !== null}
        onClose={() => setOpenExerciseId(null)}
        exercise={openExercise}
        sessionId={sessionId}
      />
    </Stack>
  )
}
```

- [ ] **Step 3: Wire the route**

In `src/routes/index.jsx`, replace:

```js
      { path: 'workout/session/:sessionId/live', ...screen('Live Session') },
```

with:

```js
      {
        path: 'workout/session/:sessionId/live',
        lazy: async () => ({
          Component: (await import('../features/workout/LiveSessionScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Verify in the browser**

Open a session, tap the play button.

| Check | Expected |
|---|---|
| Before start | "GET READY", clock at `00:00:00`, exercise cards not tappable |
| After start | clock runs, first exercise outlined, cards tappable |
| Tap an exercise, log a set | the pill moves to `1/3` immediately |
| Pause | "PAUSED", clock frozen, cards not tappable |
| Reload the page mid-session | the clock resumes where it was, not at zero |
| DevTools offline, log two sets | pills still move, the offline banner counts the pending writes |
| Back online | the banner clears; reload and the sets are still there |

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/useLiveSession.js src/features/workout/LiveSessionScreen.jsx src/routes/index.jsx
git commit -m "feat: add the live session screen"
```

---

## Task 8: Session summary screen

**Files:**
- Create: `src/features/workout/SessionSummaryScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchSession`, `fetchSessionLogs`, `summariseSession`, `pointsForWorkout`, `queryKeys`, screen states.
- Produces: nothing other modules import.

Shown after the stop button. It is also the only route today from which the member can reach the Rewards screen, since `/m/profile` is still a placeholder — so it carries that link.

- [ ] **Step 1: Write the screen**

Create `src/features/workout/SessionSummaryScreen.jsx`:

```js
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSession, fetchSessionLogs } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { pointsForWorkout, summariseSession } from './summary.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

function Stat({ label, value }) {
  return (
    <Stack sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="h2" component="p">
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )
}

export default function SessionSummaryScreen() {
  const { sessionId } = useParams()

  const session = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  const logs = useQuery({
    queryKey: queryKeys.sessionLogs(sessionId),
    queryFn: () => fetchSessionLogs(sessionId),
  })

  if (session.isPending || logs.isPending) return <LoadingState />
  if (session.isError && session.data === undefined) {
    return <ErrorState error={session.error} onRetry={session.refetch} />
  }
  if (logs.isError && logs.data === undefined) {
    return <ErrorState error={logs.error} onRetry={logs.refetch} />
  }

  const stats = summariseSession(session.data.exercises, logs.data)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">Session complete</Typography>
        <Typography color="text.secondary">{session.data.session.name}</Typography>
      </Box>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2}>
            <Stat label="Sets" value={stats.setCount} />
            <Stat label="Reps" value={stats.totalReps} />
            <Stat label="Volume" value={`${stats.volumeKg} kg`} />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3">
            Exercises
          </Typography>
          <Typography color="text.secondary">
            {stats.completedCount} of {stats.exerciseCount} completed
            {stats.allComplete ? ' — every prescription met.' : '.'}
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3">
            +{pointsForWorkout()} points
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Earned for completing this session.
          </Typography>
          <Button component={Link} to="/m/profile/rewards" variant="outlined" fullWidth>
            View rewards
          </Button>
        </CardContent>
      </Card>

      <Button component={Link} to="/m/workout" variant="contained" size="large" fullWidth>
        Back to plan
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 2: Wire the route**

In `src/routes/index.jsx`, replace:

```js
      { path: 'workout/session/:sessionId/summary', ...screen('Session Summary') },
```

with:

```js
      {
        path: 'workout/session/:sessionId/summary',
        lazy: async () => ({
          Component: (await import('../features/workout/SessionSummaryScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/workout/SessionSummaryScreen.jsx src/routes/index.jsx
git commit -m "feat: add the session summary screen"
```

---

## Task 9: Rewards

**Files:**
- Create: `src/data/rewards.js`
- Create: `src/features/rewards/RewardsScreen.jsx`
- Create: `supabase/patches/003-award-points-server-side.sql`
- Modify: `src/lib/mutationKeys.js`, `src/data/mutations.js`, `src/features/workout/LiveSessionScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `POINTS`, `rewardProgress`, `queryKeys`, `mutationKeys`.
- Produces:
  - `fetchRewards(memberId) -> Promise<Array<{id, code, title, description, points, earned_at}>>`
  - `awardReward({memberId, code, title, points}) -> Promise<row | null>`
  - `mutationKeys.awardReward` — `['awardReward']`

Matches `doc/assets/gym_member/05C - Rewards.png`: a points card with a progress bar, the list of rewards, and the points table.

- [ ] **Step 1: Write the data layer**

Create `src/data/rewards.js`:

```js
import { supabase } from '../lib/supabase.js'

export async function fetchRewards(memberId) {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, code, title, description, points, earned_at')
    .eq('member_id', memberId)
    .order('earned_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Award a reward once.
 *
 * `rewards` carries `unique (member_id, code)`, so a per-event code -- for a
 * session, `workout:<sessionId>` -- makes this idempotent: replaying the write
 * after a reconnect, or finishing the same session twice, both land on the same
 * row rather than paying out twice.
 */
export async function awardReward({ memberId, code, title, points }) {
  const { data, error } = await supabase
    .from('rewards')
    .upsert(
      { member_id: memberId, code, title, points },
      { onConflict: 'member_id,code', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  // No row means it was already awarded.  That is the intended outcome.
  return data
}
```

- [ ] **Step 2: Register the mutation**

In `src/lib/mutationKeys.js`, add to the object:

```js
  awardReward: ['awardReward'],
```

In `src/data/mutations.js`, add the import:

```js
import { awardReward } from './rewards.js'
```

and inside `registerMutationDefaults`, add:

```js
  queryClient.setMutationDefaults(mutationKeys.awardReward, {
    mutationFn: awardReward,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.rewards })
    },
  })
```

- [ ] **Step 3: Award the points when a session is finished**

In `src/features/workout/LiveSessionScreen.jsx`, add the imports:

```js
import { pointsForWorkout } from './summary.js'
import { useAuth } from '../auth/useAuth.js'
```

Add inside the component, beside the existing `useMutation`:

```js
  const { user } = useAuth()
  const award = useMutation({ mutationKey: mutationKeys.awardReward })
```

and extend `onStop` to fire it before navigating:

```js
  const onStop = () => {
    setStatus.mutate({ sessionId, status: 'completed' })
    // Per-session code, so finishing twice -- or replaying this write after a
    // reconnect -- awards once.  See the unique constraint on `rewards`.
    award.mutate({
      memberId: user.id,
      code: `workout:${sessionId}`,
      title: `Completed ${session.name}`,
      points: pointsForWorkout(),
    })
    live.clear()
    navigate(`/m/workout/session/${sessionId}/summary`, { replace: true })
  }
```

- [ ] **Step 4: Write the screen**

Create `src/features/rewards/RewardsScreen.jsx`:

```js
import {
  Box, Card, CardContent, Divider, LinearProgress, List, ListItem, ListItemText, Stack, Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { fetchRewards } from '../../data/rewards.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { POINTS, rewardProgress } from '../workout/summary.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

// What the member can spend points on.  A catalogue, not user data, so it lives
// in the client until there is a reason for it to live in Postgres.
const CATALOGUE = [
  { code: 'shake', title: 'Free Protein Shake', points: 1000 },
  { code: 'session', title: 'Free PT Session', points: 2500 },
  { code: 'month', title: 'One Month Free', points: 6000 },
]

export default function RewardsScreen() {
  const { user } = useAuth()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.rewards(user.id),
    queryFn: () => fetchRewards(user.id),
  })

  if (isPending) return <LoadingState />
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const total = data.reduce((sum, reward) => sum + reward.points, 0)
  const progress = rewardProgress(total, CATALOGUE)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Rewards</Typography>

      <Card>
        <CardContent>
          <Typography variant="h3">
            Points Earned
          </Typography>
          <Typography variant="h1" component="p">
            {progress.total.toLocaleString('en-GB')}{' '}
            <Typography component="span" variant="h3" color="text.secondary">
              pts
            </Typography>
          </Typography>

          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {progress.next === null
              ? 'Every reward unlocked.'
              : `+${progress.remaining} points to next reward`}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress.percent}
            aria-label={
              progress.next === null
                ? 'Every reward unlocked'
                : `${progress.remaining} points to the next reward`
            }
            sx={{ height: 8, borderRadius: 999, mt: 1 }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Rewards
          </Typography>
          <List disablePadding>
            {CATALOGUE.map((reward, index) => (
              <Box key={reward.code}>
                {index > 0 ? <Divider component="li" /> : null}
                <ListItem disableGutters>
                  <ListItemText
                    primary={reward.title}
                    secondary={
                      total >= reward.points
                        ? `${reward.points} points • unlocked`
                        : `${reward.points} points`
                    }
                  />
                </ListItem>
              </Box>
            ))}
          </List>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Points System
          </Typography>
          <Stack spacing={0.5}>
            <Typography>
              <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
                +{POINTS.checkin} points
              </Box>{' '}
              for each gym check-in
            </Typography>
            <Typography>
              <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
                +{POINTS.workout} points
              </Box>{' '}
              for completing a workout
            </Typography>
            <Typography>
              <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
                +{POINTS.referral} points
              </Box>{' '}
              for each friend referred
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
            Claim your reward and show the code at the reception
          </Typography>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Earned
        </Typography>
        {data.length === 0 ? (
          <EmptyState
            title="Nothing earned yet"
            description="Finish a workout to earn your first points."
          />
        ) : (
          <Stack spacing={1}>
            {data.map((reward) => (
              <Card key={reward.id}>
                <CardContent>
                  <Typography variant="h3">{reward.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    +{reward.points} points
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 5: Wire the route**

In `src/routes/index.jsx`, replace:

```js
      { path: 'profile/rewards', ...screen('Rewards') },
```

with:

```js
      {
        path: 'profile/rewards',
        lazy: async () => ({
          Component: (await import('../features/rewards/RewardsScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 6: Write the server-side points patch**

The client sends `points` with the award, and RLS only checks *who* is inserting, not *how many* points. A member could open DevTools and award themselves any number. This closes it.

Create `supabase/patches/003-award-points-server-side.sql`:

```sql
-- Derive `rewards.points` on the server.
--
-- The app awards points from the client, and the RLS policy `rewards_insert_self`
-- only checks that the row belongs to the caller -- not that the amount is
-- honest.  Anyone with DevTools could award themselves any total.  This trigger
-- overwrites whatever arrives with the value the code is actually worth, so the
-- client's number becomes a hint rather than the source of truth.
--
-- Idempotent: drops and recreates.

create or replace function public.set_reward_points() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.points := case
    when new.code like 'workout:%'  then 30
    when new.code like 'checkin:%'  then 10
    when new.code like 'referral:%' then 60
    -- An unknown code is worth nothing rather than whatever was asked for.
    else 0
  end;
  return new;
end;
$$;

drop trigger if exists rewards_set_points on rewards;

create trigger rewards_set_points
  before insert on rewards
  for each row execute function set_reward_points();

-- Confirm the trigger rejects an inflated award.
insert into rewards (member_id, code, title, points)
select id, 'workout:patch-test', 'Patch test', 999999 from profiles where role = 'member' limit 1;

select code, points, points = 30 as points_corrected
from rewards where code = 'workout:patch-test';

delete from rewards where code = 'workout:patch-test';
```

- [ ] **Step 7: Lint and build**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/data/rewards.js src/features/rewards/RewardsScreen.jsx src/lib/mutationKeys.js src/data/mutations.js src/features/workout/LiveSessionScreen.jsx src/routes/index.jsx supabase/patches/003-award-points-server-side.sql
git commit -m "feat: add rewards with server-derived points"
```

---

## Task 10: Workout builder

**Files:**
- Create: `src/features/workout/WorkoutBuilderScreen.jsx`
- Modify: `src/data/workouts.js`, `src/lib/mutationKeys.js`, `src/data/mutations.js`, `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchActivePlan`, `queryKeys`, `mutationKeys`, screen states.
- Produces:
  - `fetchExerciseCatalogue() -> Promise<Array<{id, name, muscle_group, equipment}>>`
  - `createSession({planId, name, position, exercises}) -> Promise<{id}>` where `exercises` is `[{exerciseId, position, targetSets, targetReps}]`
  - `mutationKeys.createSession` — `['createSession']`

Scope deliberately: a member adds **a session to their existing plan**, choosing exercises from the shared catalogue. RLS forbids a member writing `exercises`, so inventing new ones is out of reach and out of scope. If the member has no plan, this screen says so rather than creating one — a plan is the trainer's artefact.

- [ ] **Step 1: Add the data layer**

Append to `src/data/workouts.js`:

```js
/** The shared exercise catalogue, for the builder's picker. */
export async function fetchExerciseCatalogue() {
  const { data, error } = await supabase
    .from('exercises')
    .select('id, name, muscle_group, equipment')
    .order('name')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Create one session and its exercises.
 *
 * Two statements rather than one, because PostgREST has no transaction across
 * requests: if the second fails the session exists but is empty, which the plan
 * screen already renders as "Plan not ready" rather than crashing.  A stored
 * procedure would make it atomic and is the upgrade if this ever matters.
 */
export async function createSession({ planId, name, position, exercises }) {
  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .insert({ plan_id: planId, name, position })
    .select('id')
    .single()

  if (sessionError) throw sessionError
  if (exercises.length === 0) return session

  const { error: exercisesError } = await supabase.from('session_exercises').insert(
    exercises.map((item) => ({
      session_id: session.id,
      exercise_id: item.exerciseId,
      position: item.position,
      target_sets: item.targetSets,
      target_reps: item.targetReps,
    })),
  )

  if (exercisesError) throw exercisesError
  return session
}
```

- [ ] **Step 2: Register the mutation**

In `src/lib/mutationKeys.js`, add:

```js
  createSession: ['createSession'],
```

In `src/data/mutations.js`, add `createSession` to the import from `./workouts.js` and register it:

```js
  queryClient.setMutationDefaults(mutationKeys.createSession, {
    mutationFn: createSession,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })
```

- [ ] **Step 3: Write the screen**

Create `src/features/workout/WorkoutBuilderScreen.jsx`:

```js
import { useState } from 'react'
import {
  Autocomplete, Box, Button, Card, CardContent, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { createSession, fetchActivePlan, fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function WorkoutBuilderScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [rows, setRows] = useState([])
  const [picked, setPicked] = useState(null)

  const plan = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  const catalogue = useQuery({
    queryKey: ['exerciseCatalogue'],
    queryFn: fetchExerciseCatalogue,
  })

  const create = useMutation({ mutationKey: mutationKeys.createSession })

  if (plan.isPending || catalogue.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }
  if (!plan.data) {
    return (
      <EmptyState
        title="No plan to add to"
        description="Your trainer has not assigned you a plan yet. Sessions belong to a plan."
      />
    )
  }

  const addRow = () => {
    if (!picked) return
    setRows((current) => [...current, { exercise: picked, targetSets: 3, targetReps: 10 }])
    setPicked(null)
  }

  const updateRow = (index, field, value) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [field]: Number(value) } : row)),
    )

  const removeRow = (index) => setRows((current) => current.filter((_, i) => i !== index))

  const onSubmit = (event) => {
    event.preventDefault()

    create.mutate(
      {
        planId: plan.data.plan.id,
        name,
        // One past the highest position in use, not `length + 1`.  The two
        // agree only while positions run contiguously from 1, and `unique
        // (plan_id, position)` rejects a reused one -- so the moment a session
        // is ever deleted, counting would land on a position still occupied.
        position: Math.max(0, ...plan.data.sessions.map((session) => session.position)) + 1,
        exercises: rows.map((row, index) => ({
          exerciseId: row.exercise.id,
          position: index + 1,
          targetSets: row.targetSets,
          targetReps: row.targetReps,
        })),
      },
      { onSuccess: () => navigate('/m/workout', { replace: true }) },
    )
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">New session</Typography>

      <TextField
        label="Session name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Push Day"
        required
        fullWidth
      />

      <Stack direction="row" spacing={1}>
        <Autocomplete
          options={catalogue.data}
          getOptionLabel={(option) => option.name}
          groupBy={(option) => option.muscle_group}
          value={picked}
          onChange={(_event, value) => setPicked(value)}
          renderInput={(params) => <TextField {...params} label="Add an exercise" />}
          sx={{ flexGrow: 1 }}
        />
        <Button onClick={addRow} disabled={!picked} variant="outlined">
          Add
        </Button>
      </Stack>

      {rows.length === 0 ? (
        <EmptyState
          title="No exercises yet"
          description="Pick from the catalogue above to build the session."
        />
      ) : (
        <Stack spacing={2}>
          {rows.map((row, index) => (
            <Card key={`${row.exercise.id}-${index}`}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>
                      {row.exercise.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {row.exercise.muscle_group}
                    </Typography>
                  </Box>

                  <TextField
                    label="Sets"
                    type="number"
                    value={row.targetSets}
                    onChange={(event) => updateRow(index, 'targetSets', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 20 } }}
                    sx={{ width: 88 }}
                  />
                  <TextField
                    label="Reps"
                    type="number"
                    value={row.targetReps}
                    onChange={(event) => updateRow(index, 'targetReps', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 100 } }}
                    sx={{ width: 88 }}
                  />

                  <IconButton
                    onClick={() => removeRow(index)}
                    aria-label={`Remove ${row.exercise.name}`}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={rows.length === 0 || create.isPending}
      >
        {create.isPending ? 'Saving…' : 'Save session'}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 4: Wire the route**

In `src/routes/index.jsx`, replace:

```js
      { path: 'workout/builder', ...screen('Workout Builder') },
```

with:

```js
      {
        path: 'workout/builder',
        lazy: async () => ({
          Component: (await import('../features/workout/WorkoutBuilderScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/WorkoutBuilderScreen.jsx src/data/workouts.js src/lib/mutationKeys.js src/data/mutations.js src/routes/index.jsx
git commit -m "feat: add the workout builder"
```

---

## Phase 2 Acceptance

Not a task — the human checks that close the phase.

- [ ] `npm run lint` exits 0.
- [ ] All four self-checks print OK: `format`, `workout status`, `timer`, `summary`.
- [ ] `supabase/patches/003-award-points-server-side.sql` run in the Supabase SQL editor; the test row reports `points_corrected = true`.
- [ ] **The offline round trip, which is the graded one.** `npm run build && npm run preview` behind ngrok on a real phone: start a session, log two sets, put the phone in **airplane mode**, log three more sets and finish the session, confirm the banner counts the pending writes, then leave airplane mode and confirm every set reaches Postgres (`select * from set_logs order by performed_at` in the SQL editor).
- [ ] **The harder version of the same test:** log sets offline, then **fully close and reopen the app** while still offline, and confirm the pending writes are still there and still sync on reconnect. This is what `setMutationDefaults` exists for, and the only way to prove it works.
- [ ] Reload mid-session and confirm the clock resumes rather than resetting.
- [ ] The Rewards screen shows the points from a finished session.
- [ ] Lighthouse re-run against `http://localhost:4173`; record the score beside the Phase 0 and Phase 1 numbers for chapter 5.

## Deferred to later phases

- Nutrition, Trainer, chat, and every professional screen (Phases 3–4).
- Push notifications and the QR badge (Phase 4).
- `/m/profile` and `/m/profile/settings`, **including the sign-out control** — there is still no logout in the UI, and Phase 4 owns it.
- Editing or deleting a session the member created; the builder only appends.
- The rest timer between sets, which the schema supports (`rest_seconds`) and no screen uses yet.
