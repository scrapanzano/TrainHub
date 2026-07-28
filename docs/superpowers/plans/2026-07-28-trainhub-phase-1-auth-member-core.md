# TrainHub Phase 1 — Auth + Member Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder screens of the public and member-home/workout routes with real, data-backed screens, so a member can sign in and read their assigned plan end to end.

**Architecture:** Three layers, already established in Phase 0 and unchanged here. `src/data/*` speaks Supabase and knows nothing about React. `src/features/*` holds screens, calls `data/` through TanStack Query, and knows nothing about Supabase. `src/components/*` renders props and knows about neither. Pure logic (time formatting, status mapping, set aggregation) lives in its own modules with `assert`-based self-checks runnable under bare Node.

**Tech Stack:** React 19, React Router 8 (data router), MUI v9, TanStack Query v5, Supabase JS v2, Vite 8.

## Global Constraints

- Plain JS + JSX. **No TypeScript**, no `.ts`/`.tsx` files.
- ESM only (`"type": "module"`). No `require`.
- **No new runtime dependencies.** Everything needed is already in `package.json`. If a task seems to need one, stop and report instead.
- All user-facing copy in **English**.
- MUI components and the theme in `src/theme/index.js` carry all styling. No CSS files, no inline colour literals — use `palette.*` (including the custom `palette.task.*` group).
- No test runner exists and none is added. Non-trivial pure logic ships an `assert`-based `*.selfcheck.js` run with `node <path>`, following `src/theme/resolveTokens.selfcheck.js`.
- `npm run lint` must exit 0 at the end of every task.
- Commits: Conventional Commits, **no `Co-Authored-By` trailer** — the repository history is Davide's alone.
- Every screen must render something sane in three states: loading, error, and empty. A blank screen is a bug.
- The spec asks for errors to surface as MUI snackbars. That applies to **mutations**, which arrive in Phase 2. A failed *read* takes down the whole screen, and a snackbar floating over emptiness is still an empty screen — so read failures render inline through `ErrorState` instead. Phase 2 adds the snackbar layer for writes.
- Supabase reads are scoped by Row Level Security. Never add a `member_id` filter as a *security* measure — add it only when it narrows a legitimately broader query.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/lib/queryKeys.js` | Every TanStack Query key in one place, so invalidation cannot typo |
| `src/lib/format.js` | Pure date/time/duration formatting |
| `src/lib/format.selfcheck.js` | Assertions for the above |
| `src/data/workouts.js` | Plan, session and session-exercise reads |
| `src/data/appointments.js` | Appointment reads |
| `src/features/workout/status.js` | Session status → label/colour, set progress arithmetic |
| `src/features/workout/status.selfcheck.js` | Assertions for the above |
| `src/components/ScreenState.jsx` | Shared loading / error / empty renderers |
| `src/components/AppointmentCard.jsx` | One appointment row (Home) |
| `src/components/SessionCard.jsx` | One session row (Home, Workout Plan) |
| `src/features/auth/LoginScreen.jsx` | `/login` |
| `src/features/auth/ForgotPasswordScreen.jsx` | `/forgot-password` |
| `src/features/auth/ResetPasswordScreen.jsx` | `/reset-password` |
| `src/features/home/MemberHomeScreen.jsx` | `/m` |
| `src/features/workout/WorkoutPlanScreen.jsx` | `/m/workout` |
| `src/features/workout/SessionDetailScreen.jsx` | `/m/workout/session/:sessionId` |
| `src/features/workout/ExerciseDetailScreen.jsx` | `/m/workout/exercise/:sessionExerciseId` |

**Modified:**

| Path | Change |
|---|---|
| `src/layouts/AppLayout.jsx` | Preserve the attempted route when bouncing to `/login` |
| `src/routes/index.jsx` | Wire the real screens; rename `:exerciseId` → `:sessionExerciseId`; lazy-load both sections |

---

## Task 1: Query keys and pure formatters

**Files:**
- Create: `src/lib/queryKeys.js`
- Create: `src/lib/format.js`
- Create: `src/lib/format.selfcheck.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `queryKeys.activePlan(memberId) -> ['plan', memberId]`
  - `queryKeys.session(sessionId) -> ['session', sessionId]`
  - `queryKeys.sessionExercise(id) -> ['sessionExercise', id]`
  - `queryKeys.appointmentsOnDay(memberId, dayISO) -> ['appointments', memberId, dayISO]`
  - `formatTimeRange(startISO, endISO) -> string` e.g. `'10:00 - 11:00'`
  - `formatDate(dateISO) -> string` e.g. `'21/04/2026'`
  - `todayISO() -> string` e.g. `'2026-07-28'` (local calendar day, not UTC)

- [ ] **Step 1: Write the failing self-check**

Create `src/lib/format.selfcheck.js`:

```js
// Run with:  node src/lib/format.selfcheck.js
import assert from 'node:assert/strict'
import { formatDate, formatTimeRange, todayISO } from './format.js'

// Times render in the viewer's local zone, so the fixtures carry an explicit
// offset and the expectations are computed rather than hard-coded -- otherwise
// this file passes in Italy and fails in CI.
const start = '2026-04-21T08:00:00Z'
const end = '2026-04-21T09:00:00Z'
const local = (iso) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

assert.equal(formatTimeRange(start, end), `${local(start)} - ${local(end)}`)

// A date-only string must not shift a day backwards for anyone east of UTC,
// which is exactly what `new Date('2026-04-21')` then `.getDate()` would do.
assert.equal(formatDate('2026-04-21'), '21/04/2026')
assert.equal(formatDate(null), '')
assert.equal(formatDate(undefined), '')

// todayISO must agree with the local calendar, not with UTC.
const now = new Date()
const expected = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-')
assert.equal(todayISO(), expected)

console.log('format: OK')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node src/lib/format.selfcheck.js`
Expected: FAIL — `Cannot find module ... format.js`

- [ ] **Step 3: Write the implementation**

Create `src/lib/format.js`:

```js
// Date and time rendering, kept pure and free of imports so the self-check can
// run under bare Node with no bundler.

/** `'10:00 - 11:00'` from two ISO timestamps, in the viewer's local zone. */
export function formatTimeRange(startISO, endISO) {
  const opts = { hour: '2-digit', minute: '2-digit' }
  const start = new Date(startISO).toLocaleTimeString('en-GB', opts)
  const end = new Date(endISO).toLocaleTimeString('en-GB', opts)
  return `${start} - ${end}`
}

/**
 * `'21/04/2026'` from a Postgres `date` (`'2026-04-21'`).
 *
 * Parsed by hand rather than through `new Date()`: the Date constructor reads a
 * bare date string as UTC midnight, which renders as the previous day for every
 * viewer west of Greenwich.  A plan expiring on the 21st must not display as
 * the 20th.
 */
export function formatDate(dateISO) {
  if (!dateISO) return ''
  const [year, month, day] = String(dateISO).slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/** Today as `'YYYY-MM-DD'` in the local calendar, for day-scoped queries. */
export function todayISO() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
```

Create `src/lib/queryKeys.js`:

```js
// One home for every query key.  Invalidation elsewhere refers to these
// functions rather than retyping the array, so a rename cannot leave a stale
// cache entry that nothing invalidates.
export const queryKeys = {
  activePlan: (memberId) => ['plan', memberId],
  session: (sessionId) => ['session', sessionId],
  sessionExercise: (sessionExerciseId) => ['sessionExercise', sessionExerciseId],
  appointmentsOnDay: (memberId, dayISO) => ['appointments', memberId, dayISO],
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `node src/lib/format.selfcheck.js`
Expected: `format: OK`

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queryKeys.js src/lib/format.js src/lib/format.selfcheck.js
git commit -m "feat: add query keys and date formatting helpers"
```

---

## Task 2: Session status and set-progress logic

**Files:**
- Create: `src/features/workout/status.js`
- Create: `src/features/workout/status.selfcheck.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SESSION_STATUS` — `{ todo: {label, color}, in_progress: {...}, completed: {...} }` where `color` is a MUI palette key (`'error' | 'warning' | 'success'`)
  - `sessionStatusOf(status) -> {label, color}` — never throws, unknown input falls back to `todo`
  - `setProgress(loggedCount, targetSets) -> {done, total, label, complete}` where `label` is `'2/3'`
  - `planProgress(sessions) -> {completed, total, percent}` — `percent` is 0–100, integer

- [ ] **Step 1: Write the failing self-check**

Create `src/features/workout/status.selfcheck.js`:

```js
// Run with:  node src/features/workout/status.selfcheck.js
import assert from 'node:assert/strict'
import { planProgress, sessionStatusOf, setProgress } from './status.js'

assert.deepEqual(sessionStatusOf('todo'), { label: 'To Do', color: 'error' })
assert.deepEqual(sessionStatusOf('in_progress'), { label: 'In Progress', color: 'warning' })
assert.deepEqual(sessionStatusOf('completed'), { label: 'Completed', color: 'success' })
// A status the database grows later must degrade, not crash a screen.
assert.deepEqual(sessionStatusOf('deloading'), { label: 'To Do', color: 'error' })
assert.deepEqual(sessionStatusOf(null), { label: 'To Do', color: 'error' })

assert.deepEqual(setProgress(0, 3), { done: 0, total: 3, label: '0/3', complete: false })
assert.deepEqual(setProgress(3, 3), { done: 3, total: 3, label: '3/3', complete: true })
// Logging an extra set is allowed by the schema; it must read as complete and
// must not report more than prescribed.
assert.deepEqual(setProgress(5, 3), { done: 5, total: 3, label: '3/3', complete: true })
// A session exercise with no prescription must not produce '0/0' or NaN%.
assert.deepEqual(setProgress(0, 0), { done: 0, total: 0, label: '0/0', complete: false })

assert.deepEqual(
  planProgress([{ status: 'completed' }, { status: 'in_progress' }, { status: 'todo' }]),
  { completed: 1, total: 3, percent: 33 },
)
assert.deepEqual(planProgress([{ status: 'completed' }]), { completed: 1, total: 1, percent: 100 })
// Empty plan: percent must be 0, never NaN -- MUI renders NaN as an empty bar.
assert.deepEqual(planProgress([]), { completed: 0, total: 0, percent: 0 })

console.log('workout status: OK')
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node src/features/workout/status.selfcheck.js`
Expected: FAIL — `Cannot find module ... status.js`

- [ ] **Step 3: Write the implementation**

Create `src/features/workout/status.js`:

```js
// Pure mappings shared by the workout screens.  No imports, so the self-check
// runs under bare Node.

const TODO = { label: 'To Do', color: 'error' }

/** Session status → the label and palette key the wireframes use. */
export const SESSION_STATUS = {
  todo: TODO,
  in_progress: { label: 'In Progress', color: 'warning' },
  completed: { label: 'Completed', color: 'success' },
}

/**
 * Total-safe lookup.  The enum can gain values in the database before the UI
 * knows about them, and a screen that throws on an unrecognised status is worse
 * than one that shows a conservative default.
 */
export function sessionStatusOf(status) {
  return SESSION_STATUS[status] ?? TODO
}

/**
 * Progress for one exercise, as the `0/3` pill in the wireframes.
 *
 * `done` is the raw count and `label` is clamped: nothing stops a member from
 * logging a fourth set, but `4/3` reads like a bug to everyone who sees it.
 */
export function setProgress(loggedCount, targetSets) {
  const done = loggedCount ?? 0
  const total = targetSets ?? 0
  return {
    done,
    total,
    label: `${Math.min(done, total)}/${total}`,
    complete: total > 0 && done >= total,
  }
}

/** Plan-level roll-up. `percent` stays an integer so it can key an aria-label. */
export function planProgress(sessions) {
  const total = sessions.length
  const completed = sessions.filter((s) => s.status === 'completed').length
  // Guard the divide: an empty plan is a real state (a member with no plan yet)
  // and 0/0 would put NaN into a progress bar.
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  return { completed, total, percent }
}
```

- [ ] **Step 4: Run the self-check to verify it passes**

Run: `node src/features/workout/status.selfcheck.js`
Expected: `workout status: OK`

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/status.js src/features/workout/status.selfcheck.js
git commit -m "feat: add session status and set progress helpers"
```

---

## Task 3: Data layer for workouts and appointments

**Files:**
- Create: `src/data/workouts.js`
- Create: `src/data/appointments.js`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js`.
- Produces:
  - `fetchActivePlan(memberId) -> Promise<{plan, sessions} | null>` — `null` when the member has no plan. `sessions` are ordered by `position`.
  - `fetchSession(sessionId) -> Promise<{session, exercises}>` — each entry of `exercises` is `{id, position, target_sets, target_reps, target_weight, rest_seconds, notes, exercise: {id, name, muscle_group, equipment, instructions, video_url, image_url}, loggedCount}`.
  - `fetchSessionExercise(sessionExerciseId) -> Promise<{...sameShapeAsAbove, session: {id, name}}>`
  - `fetchAppointmentsOnDay(memberId, dayISO) -> Promise<Array<{id, kind, status, starts_at, ends_at, notes, pro: {id, full_name, avatar_url}}>>` — ordered by `starts_at`.

All four **throw** on a Supabase error. TanStack Query turns a thrown error into `isError`; returning `{data, error}` would make every caller re-check by hand.

- [ ] **Step 1: Write `src/data/workouts.js`**

```js
import { supabase } from '../lib/supabase.js'

// PostgREST embeds related rows through the foreign keys already declared in
// schema.sql.  `set_logs(count)` is an embedded aggregate: it returns how many
// set_logs point at each session_exercise without shipping the rows.  Row Level
// Security scopes that count to the signed-in member automatically, so no
// member_id filter is needed -- and adding one would not make it safer.
const SESSION_EXERCISE_COLUMNS = `
  id, position, target_sets, target_reps, target_weight, rest_seconds, notes,
  exercise:exercises ( id, name, muscle_group, equipment, instructions, video_url, image_url ),
  set_logs ( count )
`

// PostgREST returns an embedded count as `[{ count: n }]`, or `[]` when nothing
// matches.  Flatten it here so no screen has to know that shape.
const withLoggedCount = (row) => {
  const { set_logs: logs, ...rest } = row
  return { ...rest, loggedCount: logs?.[0]?.count ?? 0 }
}

/**
 * The member's current plan and its sessions.
 *
 * A member can hold several plans over time; "current" is the most recently
 * created one.  Returns null rather than throwing when there is none, because
 * a member who has not been assigned a plan yet is an ordinary state that the
 * Home and Workout screens both render as an empty state.
 */
export async function fetchActivePlan(memberId) {
  const { data: plan, error: planError } = await supabase
    .from('workout_plans')
    .select('id, name, goal, level, weeks, expires_on, author:profiles!workout_plans_author_id_fkey ( id, full_name )')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (planError) throw planError
  if (!plan) return null

  const { data: sessions, error: sessionsError } = await supabase
    .from('workout_sessions')
    .select('id, name, position, status, session_exercises ( count )')
    .eq('plan_id', plan.id)
    .order('position')

  if (sessionsError) throw sessionsError

  return {
    plan,
    sessions: (sessions ?? []).map(({ session_exercises: exercises, ...session }) => ({
      ...session,
      exerciseCount: exercises?.[0]?.count ?? 0,
    })),
  }
}

/** One session with its prescribed exercises, ordered as the trainer wrote them. */
export async function fetchSession(sessionId) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`id, name, position, status, session_exercises ( ${SESSION_EXERCISE_COLUMNS} )`)
    .eq('id', sessionId)
    .single()

  if (error) throw error

  const { session_exercises: exercises, ...session } = data
  return {
    session,
    // PostgREST does not order embedded rows, so sort here rather than trusting
    // insertion order -- the trainer's sequencing is meaningful.
    exercises: (exercises ?? []).map(withLoggedCount).sort((a, b) => a.position - b.position),
  }
}

/** One prescribed exercise, plus enough of its session to render a back link. */
export async function fetchSessionExercise(sessionExerciseId) {
  const { data, error } = await supabase
    .from('session_exercises')
    .select(`${SESSION_EXERCISE_COLUMNS}, session:workout_sessions ( id, name )`)
    .eq('id', sessionExerciseId)
    .single()

  if (error) throw error
  return withLoggedCount(data)
}
```

- [ ] **Step 2: Write `src/data/appointments.js`**

```js
import { supabase } from '../lib/supabase.js'

/**
 * Every appointment the member has on one local calendar day.
 *
 * The bounds are built from the local day and converted to UTC by `toISOString`,
 * so "today" means the member's today.  Comparing the timestamptz column against
 * a bare date string would instead compare against UTC midnight and drop the
 * evening's appointments for anyone east of Greenwich.
 */
export async function fetchAppointmentsOnDay(memberId, dayISO) {
  const [year, month, day] = dayISO.split('-').map(Number)
  const from = new Date(year, month - 1, day, 0, 0, 0, 0)
  const to = new Date(year, month - 1, day + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(
      'id, kind, status, starts_at, ends_at, notes, pro:profiles!appointments_pro_id_fkey ( id, full_name, avatar_url )',
    )
    .eq('member_id', memberId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')

  if (error) throw error
  return data ?? []
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Verify the embedded selects against the real database**

These queries only fail at runtime, and the failure is a PostgREST message about
an ambiguous or missing relationship — worth catching now rather than from a
blank screen. Run the dev server and, in the browser console:

```js
const { supabase } = await import('/src/lib/supabase.js')
await supabase.auth.signInWithPassword({
  email: 'daniel@trainhub.dev',
  password: 'TrainHub2026!',
})
const { fetchActivePlan } = await import('/src/data/workouts.js')
const { data: { user } } = await supabase.auth.getUser()
console.log(await fetchActivePlan(user.id))
```

Expected: an object with `plan.name === 'Hypetrophy - Phase 1'` and four sessions
carrying non-zero `exerciseCount`. If instead you get
`Could not embed because more than one relationship was found`, the explicit
`!constraint_name` hint on that join is wrong — read the constraint names with
`\d workout_plans` in the SQL editor and correct them.

- [ ] **Step 5: Commit**

```bash
git add src/data/workouts.js src/data/appointments.js
git commit -m "feat: add workout and appointment data layer"
```

---

## Task 4: Shared screen states

**Files:**
- Create: `src/components/ScreenState.jsx`

**Interfaces:**
- Consumes: nothing but MUI.
- Produces:
  - `<LoadingState />` — centred spinner with `role="status"`
  - `<ErrorState error={Error} onRetry={fn?} />` — message plus optional Retry button
  - `<EmptyState title={string} description={string?} action={ReactNode?} />`

Every screen in this phase uses these three. Writing them once is the difference
between consistent states and eight slightly different spinners.

- [ ] **Step 1: Write the component**

Create `src/components/ScreenState.jsx`:

```js
import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'

const centred = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  p: 4,
  gap: 2,
  minHeight: 240,
}

export function LoadingState() {
  // role="status" so a screen reader announces the wait instead of silence.
  return (
    <Box sx={centred} role="status" aria-label="Loading">
      <CircularProgress />
    </Box>
  )
}

export function ErrorState({ error, onRetry }) {
  // Offline is the common case in this app, not an exception, so it gets its own
  // wording -- "something went wrong" would send a user hunting for a fault that
  // is really just a tunnel or a lift.
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <Box sx={centred} role="alert">
      <Typography variant="h3">{offline ? 'You are offline' : 'Something went wrong'}</Typography>
      <Typography color="text.secondary">
        {offline
          ? 'This screen needs data we have not cached yet. It will load once you are back online.'
          : (error?.message ?? 'Please try again.')}
      </Typography>
      {onRetry ? (
        <Button variant="contained" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Box>
  )
}

export function EmptyState({ title, description, action }) {
  return (
    <Box sx={centred}>
      <Stack spacing={1} alignItems="center">
        <Typography variant="h3">{title}</Typography>
        {description ? <Typography color="text.secondary">{description}</Typography> : null}
      </Stack>
      {action}
    </Box>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/ScreenState.jsx
git commit -m "feat: add shared loading, error and empty screen states"
```

---

## Task 5: Login screen

**Files:**
- Create: `src/features/auth/LoginScreen.jsx`
- Modify: `src/layouts/AppLayout.jsx` (the `!user` branch)
- Modify: `src/routes/index.jsx` (the `/login` route)

**Interfaces:**
- Consumes: `useAuth()` from `src/features/auth/useAuth.js`, which returns `{session, user, profile, profileError, loading, signOut}`.
- Produces: nothing other modules import.

Matches `doc/assets/pt/01 - Login.png`: centred logo, "Welcome to TrainHub" with
`Hub` in the primary colour, subtitle, Email and Password fields, a right-aligned
"Forgot Password?" link, and a full-width Log In button pinned to the bottom.

- [ ] **Step 1: Preserve the attempted route in `AppLayout`**

In `src/layouts/AppLayout.jsx`, add `useLocation` to the existing `react-router`
import and replace the `!user` branch.

Change the import line from:

```js
import { Navigate, Outlet } from 'react-router'
```

to:

```js
import { Navigate, Outlet, useLocation } from 'react-router'
```

Add the hook alongside the existing `useAuth()` call, at the top of the component
body — before the `if (loading)` early return, because hooks cannot be called
conditionally:

```js
  const { user, profile, profileError, loading, signOut } = useAuth()
  const location = useLocation()
```

Replace:

```js
  if (!user) return <Navigate to="/login" replace />
```

with:

```js
  // Carry where they were headed, so signing in resumes the journey instead of
  // dumping everyone on the home screen.  `replace` keeps the bounced-from URL
  // out of history: Back should leave the app, not re-trigger this redirect.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
```

- [ ] **Step 2: Write the login screen**

Create `src/features/auth/LoginScreen.jsx`:

```js
import { useState } from 'react'
import { Alert, Box, Button, Link as MuiLink, Stack, TextField, Typography } from '@mui/material'
import { Link, Navigate, useLocation } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'

const HOME_FOR = { member: '/m', professional: '/p' }

export default function LoginScreen() {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Redirect on rendered state rather than from the submit handler.  The session
  // arrives through onAuthStateChange, and the profile that decides WHERE to go
  // arrives one fetch later; navigating from the handler would race both.
  if (user && profile) {
    return <Navigate to={location.state?.from ?? HOME_FOR[profile.role] ?? '/m'} replace />
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      // Supabase answers "Invalid login credentials" for a wrong password AND
      // for an unconfirmed address, on purpose -- it will not reveal which
      // addresses are registered.  Passing it through unchanged keeps that.
      setError(signInError.message)
      setSubmitting(false)
      return
    }
    // Deliberately no setSubmitting(false) on success: the redirect above
    // unmounts this screen, and re-enabling the button first lets an impatient
    // second tap fire a second sign-in.
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ width: '100%' }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">
          Welcome to Train<Box component="span" sx={{ color: 'primary.main' }}>Hub</Box>
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Log In to begin your fitness journey.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Stack spacing={2}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@email.com"
          autoComplete="email"
          required
          fullWidth
        />
        <Box>
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            fullWidth
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <MuiLink component={Link} to="/forgot-password" underline="hover">
              Forgot Password?
            </MuiLink>
          </Box>
        </Box>
      </Stack>

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        // `loading` covers the gap between a restored session and its profile:
        // without it the form is briefly live underneath a redirect about to fire.
        disabled={submitting || loading}
      >
        {submitting ? 'Logging in…' : 'Log In'}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 3: Wire the route**

In `src/routes/index.jsx`, add the import below the existing `Placeholder` import:

```js
import LoginScreen from '../features/auth/LoginScreen.jsx'
```

Replace:

```js
      { path: '/login', ...screen('Login') },
```

with:

```js
      { path: '/login', element: <LoginScreen /> },
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, open `http://localhost:5173/login`.

Check each of these:

| Action | Expected |
|---|---|
| Submit with an empty email | the browser's own required-field prompt; no network call |
| `daniel@trainhub.dev` + a wrong password | red alert reading "Invalid login credentials"; button live again |
| `daniel@trainhub.dev` / `TrainHub2026!` | lands on `/m` |
| Visit `/m/workout` while signed out, then sign in | lands on `/m/workout`, not `/m` |
| Visit `/login` while already signed in | redirected straight to `/m` |
| Sign in as `andrea@trainhub.dev` / `TrainHub2026!` | lands on `/p` |

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/auth/LoginScreen.jsx src/layouts/AppLayout.jsx src/routes/index.jsx
git commit -m "feat: add login screen with attempted-route resume"
```

---

## Task 6: Forgot-password screen

**Files:**
- Create: `src/features/auth/ForgotPasswordScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `supabase`.
- Produces: nothing other modules import.

Matches `doc/assets/pt/02 - Forgot Password.png`: back arrow, logo, heading,
explanatory paragraph, one Email field, "Send Link" button at the bottom.

- [ ] **Step 1: Write the screen**

Create `src/features/auth/ForgotPasswordScreen.jsx`:

```js
import { useState } from 'react'
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase.js'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      // Built from the live origin so the same code works on localhost, on the
      // preview server and behind the ngrok tunnel.  Every origin used must also
      // be listed in Supabase → Authentication → URL Configuration → Redirect
      // URLs, or Supabase silently sends the user to the Site URL instead.
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (resetError) {
      setError(resetError.message)
      setSubmitting(false)
      return
    }

    setSent(true)
    setSubmitting(false)
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ width: '100%' }}>
      <Box>
        <IconButton component={Link} to="/login" aria-label="Back to login" edge="start">
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">Forgot Password?</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Don&apos;t worry! Enter the email address associated with your account and we&apos;ll send
          you a link to reset your password.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {/* Confirmed without saying whether the address exists -- the same wording
          appears either way, so this screen cannot be used to enumerate users. */}
      {sent ? (
        <Alert severity="success">
          If an account exists for {email}, a reset link is on its way. Check your inbox.
        </Alert>
      ) : null}

      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="name@email.com"
        autoComplete="email"
        required
        fullWidth
      />

      <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting || sent}>
        {submitting ? 'Sending…' : 'Send Link'}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 2: Wire the route**

In `src/routes/index.jsx` add:

```js
import ForgotPasswordScreen from '../features/auth/ForgotPasswordScreen.jsx'
```

Replace:

```js
      { path: '/forgot-password', ...screen('Forgot Password') },
```

with:

```js
      { path: '/forgot-password', element: <ForgotPasswordScreen /> },
```

- [ ] **Step 3: Register the redirect URLs in Supabase (manual)**

In the Supabase dashboard → **Authentication → URL Configuration → Redirect URLs**,
add all three:

```
http://localhost:5173/reset-password
http://localhost:4173/reset-password
https://<your-static-domain>.ngrok-free.dev/reset-password
```

Without these the reset email lands on the Site URL and the next task's screen
never sees a code.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, open `http://localhost:5173/forgot-password`.

- Submit `daniel@trainhub.dev` → green confirmation, button disabled.
- The email arrives (Supabase's free tier is rate-limited to a few per hour;
  if nothing arrives, check **Authentication → Logs** before assuming a bug).
- The link points at `/reset-password?code=...`.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/auth/ForgotPasswordScreen.jsx src/routes/index.jsx
git commit -m "feat: add forgot password screen"
```

---

## Task 7: Reset-password screen

**Files:**
- Create: `src/features/auth/ResetPasswordScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `supabase`.
- Produces: nothing other modules import.

Matches `doc/assets/pt/03 - Set Password.png`. This is the one screen that must
consume a URL-borne session: `src/lib/supabase.js` sets
`detectSessionInUrl: false`, so the exchange happens here, explicitly.

- [ ] **Step 1: Write the screen**

Create `src/features/auth/ResetPasswordScreen.jsx`:

```js
import { useEffect, useState } from 'react'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { supabase } from '../../lib/supabase.js'

export default function ResetPasswordScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const code = params.get('code')

  // 'exchanging' → 'ready' | 'invalid', then 'saving' → 'done'.  One state
  // machine beats four booleans that can contradict each other.
  const [phase, setPhase] = useState(code ? 'exchanging' : 'invalid')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!code) return
    let active = true

    // The client is configured with detectSessionInUrl: false, so nothing has
    // consumed this code yet and the exchange must be explicit.
    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error: exchangeError }) => {
        if (!active) return
        if (exchangeError) {
          setError(exchangeError.message)
          setPhase('invalid')
          return
        }
        setPhase('ready')
      })
      .catch((cause) => {
        if (!active) return
        setError(cause?.message ?? 'Could not verify the reset link.')
        setPhase('invalid')
      })

    return () => {
      active = false
    }
  }, [code])

  const onSubmit = async (event) => {
    event.preventDefault()
    setError(null)

    if (password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }

    setPhase('saving')
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setPhase('ready')
      return
    }

    // The exchange already signed them in, so send them to the app rather than
    // making them type the password they just chose.
    setPhase('done')
    navigate('/m', { replace: true })
  }

  if (phase === 'invalid') {
    return (
      <Stack spacing={3} sx={{ width: '100%', textAlign: 'center' }}>
        <Typography variant="h1">Link not valid</Typography>
        <Typography color="text.secondary">
          {error ?? 'This reset link is missing its code.'} Reset links expire, can be used once,
          and must be opened in the same browser that requested them.
        </Typography>
        <Button component={Link} to="/forgot-password" variant="contained" size="large" fullWidth>
          Request a new link
        </Button>
      </Stack>
    )
  }

  if (phase === 'exchanging') {
    return (
      <Typography role="status" sx={{ textAlign: 'center' }}>
        Verifying your link…
      </Typography>
    )
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ width: '100%' }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">Set a new password</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Choose a password you have not used on this account before.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <TextField
        label="New password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
      />
      <TextField
        label="Confirm password"
        type="password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
      />

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={phase === 'saving'}
      >
        {phase === 'saving' ? 'Saving…' : 'Save password'}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 2: Wire the route**

In `src/routes/index.jsx` add:

```js
import ResetPasswordScreen from '../features/auth/ResetPasswordScreen.jsx'
```

Replace:

```js
      { path: '/reset-password', ...screen('Reset Password') },
```

with:

```js
      { path: '/reset-password', element: <ResetPasswordScreen /> },
```

- [ ] **Step 3: Verify in the browser**

| Action | Expected |
|---|---|
| Open `/reset-password` with no query string | "Link not valid" plus a Request-a-new-link button |
| Open `/reset-password?code=garbage` | "Link not valid" with the Supabase error quoted |
| Open the real link from the reset email, same browser | the password form |
| Enter two different passwords | "The two passwords do not match." |
| Enter a 5-character password twice | "Use at least 8 characters." |
| Enter a valid matching password | lands on `/m`, signed in |
| Reload the used link | "Link not valid" — codes are single-use |

Note for the demo: PKCE stores the code verifier in the browser that requested
the reset, so opening the link on a *different* device fails by design. Request
and open on the same device.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/auth/ResetPasswordScreen.jsx src/routes/index.jsx
git commit -m "feat: add reset password screen with explicit code exchange"
```

---

## Task 8: Appointment and session cards

**Files:**
- Create: `src/components/AppointmentCard.jsx`
- Create: `src/components/SessionCard.jsx`

**Interfaces:**
- Consumes: `formatTimeRange` from `src/lib/format.js`; `sessionStatusOf` from `src/features/workout/status.js`.
- Produces:
  - `<AppointmentCard appointment={{id, kind, status, starts_at, ends_at, pro}} />`
  - `<SessionCard session={{id, name, status, exerciseCount}} to={string} />`

Both appear on more than one screen, which is why they are components rather than
markup inside a screen.

- [ ] **Step 1: Write `src/components/AppointmentCard.jsx`**

```js
import { Avatar, Box, Card, CardContent, Stack, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { formatTimeRange } from '../lib/format.js'

// The appointment_kind enum, mapped to the custom palette group in the theme.
const KIND_LABEL = {
  training: 'Personal Training',
  protocol: 'Protocol Consultation',
  nutrition: 'Nutrition Consultation',
}

export default function AppointmentCard({ appointment }) {
  const { kind, status, starts_at: startsAt, ends_at: endsAt, pro } = appointment
  const done = status === 'done'

  return (
    <Card
      sx={{
        // A finished appointment recedes; an upcoming one keeps its type colour.
        // Cancelled reads as finished on purpose -- neither needs attention.
        bgcolor: done || status === 'cancelled' ? 'task.done' : `task.${kind}`,
        border: 'none',
      }}
    >
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ color: 'text.primary', display: 'flex' }}>
            {done ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {formatTimeRange(startsAt, endsAt)}
            </Typography>
            <Typography variant="h3" noWrap>
              {KIND_LABEL[kind] ?? 'Appointment'}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <Avatar src={pro?.avatar_url ?? undefined} sx={{ width: 20, height: 20 }}>
                {pro?.full_name?.[0] ?? '?'}
              </Avatar>
              <Typography variant="body2" color="text.secondary" noWrap>
                {pro?.full_name ?? 'Unassigned'}
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Write `src/components/SessionCard.jsx`**

```js
import { Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { Link } from 'react-router'
import { sessionStatusOf } from '../features/workout/status.js'

export default function SessionCard({ session, to }) {
  const { label, color } = sessionStatusOf(session.status)

  return (
    <Card>
      <CardActionArea component={Link} to={to}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="baseline">
                <Typography variant="h3" noWrap>
                  {session.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  • {session.exerciseCount} exercises
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                {/* A coloured dot alone would carry the status by hue only, so the
                    label sits next to it and the dot is hidden from the reader. */}
                <Box
                  aria-hidden
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: `${color}.main` }}
                />
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </Stack>
            </Box>

            <ChevronRightIcon color="primary" />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/AppointmentCard.jsx src/components/SessionCard.jsx
git commit -m "feat: add appointment and session cards"
```

---

## Task 9: Member home screen

**Files:**
- Create: `src/features/home/MemberHomeScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchAppointmentsOnDay`, `fetchActivePlan`, `queryKeys`, `todayISO`, `AppointmentCard`, `SessionCard`, `LoadingState`, `ErrorState`, `EmptyState`, `useAuth`.
- Produces: nothing other modules import.

Matches `doc/assets/gym_member/01 - Home Page.png`: the top header (already built
in Phase 0) followed by a "Today • N activities" section of appointment cards and
a "Workout" section showing the session currently in progress.

- [ ] **Step 1: Write the screen**

Create `src/features/home/MemberHomeScreen.jsx`:

```js
import { Box, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { fetchAppointmentsOnDay } from '../../data/appointments.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import SessionCard from '../../components/SessionCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function MemberHomeScreen() {
  const { user } = useAuth()
  const memberId = user.id
  const day = todayISO()

  const appointments = useQuery({
    queryKey: queryKeys.appointmentsOnDay(memberId, day),
    queryFn: () => fetchAppointmentsOnDay(memberId, day),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(memberId),
    queryFn: () => fetchActivePlan(memberId),
  })

  // The header already greets by name, so this screen leads with the day's work.
  // Show whatever is under way; failing that, the next thing to do.
  const sessions = plan.data?.sessions ?? []
  const current =
    sessions.find((session) => session.status === 'in_progress') ??
    sessions.find((session) => session.status === 'todo')

  return (
    <Stack spacing={4} sx={{ p: 2 }}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 2 }}>
          <Typography variant="h1">Today</Typography>
          <Typography variant="h3" color="text.secondary">
            • {appointments.data?.length ?? 0} activities
          </Typography>
        </Stack>

        {appointments.isPending ? <LoadingState /> : null}
        {appointments.isError ? (
          <ErrorState error={appointments.error} onRetry={appointments.refetch} />
        ) : null}
        {appointments.isSuccess && appointments.data.length === 0 ? (
          <EmptyState
            title="Nothing booked today"
            description="Your appointments with your trainer will show up here."
          />
        ) : null}

        <Stack spacing={2}>
          {(appointments.data ?? []).map((appointment) => (
            <AppointmentCard key={appointment.id} appointment={appointment} />
          ))}
        </Stack>
      </Box>

      <Box>
        <Typography variant="h1" sx={{ mb: 2 }}>
          Workout
        </Typography>

        {plan.isPending ? <LoadingState /> : null}
        {plan.isError ? <ErrorState error={plan.error} onRetry={plan.refetch} /> : null}
        {plan.isSuccess && !current ? (
          <EmptyState
            title={plan.data ? 'Plan complete' : 'No plan yet'}
            description={
              plan.data
                ? 'Every session in your plan is done. Nice work.'
                : 'Your trainer has not assigned you a workout plan yet.'
            }
          />
        ) : null}

        {current ? (
          <SessionCard session={current} to={`/m/workout/session/${current.id}`} />
        ) : null}
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 2: Wire the route**

In `src/routes/index.jsx` add:

```js
import MemberHomeScreen from '../features/home/MemberHomeScreen.jsx'
```

Replace, inside the `/m` children:

```js
      { index: true, ...screen('Home') },
```

with:

```js
      { index: true, element: <MemberHomeScreen /> },
```

- [ ] **Step 3: Verify in the browser**

Sign in as `daniel@trainhub.dev` and open `/m`.

| Check | Expected |
|---|---|
| Today section | the seeded appointments for today, or the "Nothing booked today" empty state if the seed's dates have passed |
| Appointment colours | the type colour for upcoming, grey for done |
| Workout section | the "Leg Day" card, status "In Progress" |
| Tap the card | navigates to `/m/workout/session/<id>` (still a placeholder until Task 11) |
| DevTools → Application → IndexedDB | `keyval-store` → `keyval` → `trainhub-query-cache` now **exists** — this is the first screen that puts anything through TanStack Query |
| Reload with DevTools offline | the screen still renders from the persisted cache |

If the Today section is empty, the seed's appointment dates are in the past.
That is expected, not a bug — re-seed with today's date if you want a populated
demo.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/home/MemberHomeScreen.jsx src/routes/index.jsx
git commit -m "feat: add member home screen"
```

---

## Task 10: Workout plan screen

**Files:**
- Create: `src/features/workout/WorkoutPlanScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchActivePlan`, `queryKeys`, `formatDate`, `planProgress`, `SessionCard`, screen states, `useAuth`.
- Produces: nothing other modules import.

Matches `doc/assets/gym_member/02 - Workout.png`: a plan header card (name, goal
and level, session count, duration, author, expiry) above a "Sessions" list.

- [ ] **Step 1: Write the screen**

Create `src/features/workout/WorkoutPlanScreen.jsx`:

```js
import { Box, Card, CardContent, Divider, LinearProgress, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatDate } from '../../lib/format.js'
import { planProgress } from './status.js'
import SessionCard from '../../components/SessionCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function WorkoutPlanScreen() {
  const { user } = useAuth()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  if (isPending) return <LoadingState />
  if (isError) return <ErrorState error={error} onRetry={refetch} />
  if (!data) {
    return (
      <EmptyState
        title="No plan yet"
        description="Once your trainer assigns a workout plan, it will appear here."
      />
    )
  }

  const { plan, sessions } = data
  const progress = planProgress(sessions)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Workout Plan</Typography>

      <Card>
        <CardContent>
          <Typography variant="h2">{plan.name}</Typography>
          <Typography color="primary" sx={{ mb: 2 }}>
            {[plan.goal, plan.level].filter(Boolean).join(' - ')}
          </Typography>

          {/* Two columns on any phone wide enough, stacked below that -- the
              labels are short but "Duration: 6 weeks" still wraps badly at 320px. */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              rowGap: 0.5,
              columnGap: 2,
            }}
          >
            <Typography variant="body2">Sessions: {sessions.length}</Typography>
            <Typography variant="body2">Duration: {plan.weeks} weeks</Typography>
            {plan.author ? (
              <Typography variant="body2">Created by: {plan.author.full_name}</Typography>
            ) : null}
          </Box>

          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={progress.percent}
              aria-label={`${progress.completed} of ${progress.total} sessions completed`}
              sx={{ height: 8, borderRadius: 999 }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {progress.completed} of {progress.total} sessions completed
            </Typography>
          </Box>

          {plan.expires_on ? (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                Expiration: {formatDate(plan.expires_on)}
              </Typography>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Sessions
        </Typography>

        {sessions.length === 0 ? (
          <EmptyState
            title="This plan has no sessions"
            description="Your trainer is still putting it together."
          />
        ) : (
          <Stack spacing={2}>
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                to={`/m/workout/session/${session.id}`}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 2: Wire the route**

In `src/routes/index.jsx` add:

```js
import WorkoutPlanScreen from '../features/workout/WorkoutPlanScreen.jsx'
```

Replace:

```js
      { path: 'workout', ...screen('Workout Plan') },
```

with:

```js
      { path: 'workout', element: <WorkoutPlanScreen /> },
```

- [ ] **Step 3: Verify in the browser**

Open `/m/workout` as `daniel@trainhub.dev`.

| Check | Expected |
|---|---|
| Header card | "Hypetrophy - Phase 1", "Strength - Beginner", Sessions: 4, Duration: 6 weeks, Created by: Coach Andrea |
| Expiry | rendered as `dd/mm/yyyy`, matching the seeded date exactly — an off-by-one day means `formatDate` regressed |
| Progress bar | matches the count below it |
| Session list | four cards, correct status dots and labels |
| Workout tab | highlighted; visiting `/m/workout/session/<id>` leaves it highlighted |
| Narrow the viewport to 320px | no horizontal scrollbar |

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/workout/WorkoutPlanScreen.jsx src/routes/index.jsx
git commit -m "feat: add workout plan screen"
```

---

## Task 11: Session detail and exercise detail

**Files:**
- Create: `src/features/workout/SessionDetailScreen.jsx`
- Create: `src/features/workout/ExerciseDetailScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchSession`, `fetchSessionExercise`, `queryKeys`, `setProgress`, screen states.
- Produces: nothing other modules import.

Matches `doc/assets/gym_member/06 - Session.png`: a sticky session header with a
play button, then a list of exercises each showing muscle group, `3 sets • 10
reps`, and a `0/3` progress pill.

**Route change:** the plan's route is `/m/workout/exercise/:exerciseId`, but the
screen needs the *prescription* (sets, reps, rest), which lives on
`session_exercises`, not on the shared `exercises` catalogue. The parameter is
renamed to `:sessionExerciseId` so the name states what it holds. The URL path
is unchanged.

The live-session play button is Phase 2; here it links to `.../live`, which is
still a placeholder.

- [ ] **Step 1: Write `src/features/workout/SessionDetailScreen.jsx`**

```js
import { Box, Card, CardActionArea, CardContent, Chip, IconButton, Stack, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSession } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { setProgress } from './status.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

export default function SessionDetailScreen() {
  const { sessionId } = useParams()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  if (isPending) return <LoadingState />
  if (isError) return <ErrorState error={error} onRetry={refetch} />

  const { session, exercises } = data

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton component={Link} to="/m/workout" aria-label="Back to plan" edge="start">
              <ArrowBackIosNewIcon fontSize="small" />
            </IconButton>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" noWrap>
                {session.name}
              </Typography>
              <Typography color="text.secondary">{exercises.length} exercises</Typography>
            </Box>

            <IconButton
              component={Link}
              to={`/m/workout/session/${session.id}/live`}
              aria-label="Start session"
              color="primary"
              size="large"
            >
              <PlayArrowIcon fontSize="large" />
            </IconButton>
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

            return (
              <Card key={item.id}>
                <CardActionArea component={Link} to={`/m/workout/exercise/${item.id}`}>
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

                      <Chip
                        label={progress.label}
                        size="small"
                        color={progress.complete ? 'success' : 'primary'}
                      />
                      <ChevronRightIcon color="primary" />
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            )
          })}
        </Stack>
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 2: Write `src/features/workout/ExerciseDetailScreen.jsx`**

```js
import { Box, Card, CardContent, Chip, Divider, IconButton, Stack, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSessionExercise } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { setProgress } from './status.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

// One prescription line.  Rendered as a definition list so the pairing survives
// for a screen reader instead of collapsing into loose text.
function Fact({ label, value }) {
  return (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 1 }}>
      <Typography component="dt" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>
        {value}
      </Typography>
    </Stack>
  )
}

export default function ExerciseDetailScreen() {
  const { sessionExerciseId } = useParams()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.sessionExercise(sessionExerciseId),
    queryFn: () => fetchSessionExercise(sessionExerciseId),
  })

  if (isPending) return <LoadingState />
  if (isError) return <ErrorState error={error} onRetry={refetch} />

  const { exercise, session } = data
  const progress = setProgress(data.loggedCount, data.target_sets)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <IconButton
          component={Link}
          to={`/m/workout/session/${session.id}`}
          aria-label={`Back to ${session.name}`}
          edge="start"
        >
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {session.name}
          </Typography>
          <Typography variant="h1" noWrap>
            {exercise.name}
          </Typography>
        </Box>
      </Stack>

      {exercise.image_url ? (
        <Box
          component="img"
          src={exercise.image_url}
          alt=""
          sx={{ width: '100%', borderRadius: 4, display: 'block' }}
        />
      ) : null}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={exercise.muscle_group} />
        {exercise.equipment ? <Chip label={exercise.equipment} variant="outlined" /> : null}
        <Chip label={`${progress.label} sets logged`} color={progress.complete ? 'success' : 'primary'} />
      </Stack>

      <Card>
        <CardContent component="dl" sx={{ m: 0 }}>
          <Fact label="Sets" value={data.target_sets} />
          <Divider />
          <Fact label="Reps" value={data.target_reps} />
          {data.target_weight ? (
            <>
              <Divider />
              <Fact label="Weight" value={`${data.target_weight} kg`} />
            </>
          ) : null}
          <Divider />
          <Fact label="Rest" value={`${data.rest_seconds}s`} />
        </CardContent>
      </Card>

      {exercise.instructions ? (
        <Box>
          <Typography variant="h2" sx={{ mb: 1 }}>
            How to perform
          </Typography>
          <Typography color="text.secondary">{exercise.instructions}</Typography>
        </Box>
      ) : null}

      {data.notes ? (
        <Box>
          <Typography variant="h2" sx={{ mb: 1 }}>
            Trainer&apos;s note
          </Typography>
          <Typography color="text.secondary">{data.notes}</Typography>
        </Box>
      ) : null}
    </Stack>
  )
}
```

- [ ] **Step 3: Wire the routes**

In `src/routes/index.jsx` add:

```js
import SessionDetailScreen from '../features/workout/SessionDetailScreen.jsx'
import ExerciseDetailScreen from '../features/workout/ExerciseDetailScreen.jsx'
```

Replace:

```js
      { path: 'workout/session/:sessionId', ...screen('Session Detail') },
```

with:

```js
      { path: 'workout/session/:sessionId', element: <SessionDetailScreen /> },
```

and replace:

```js
      { path: 'workout/exercise/:exerciseId', ...screen('Exercise Details') },
```

with:

```js
      // The parameter is a `session_exercises.id`, not an `exercises.id`: this
      // screen shows the prescription (sets, reps, rest), which only exists on
      // the join row.  The path segment is unchanged.
      { path: 'workout/exercise/:sessionExerciseId', element: <ExerciseDetailScreen /> },
```

- [ ] **Step 4: Verify in the browser**

| Check | Expected |
|---|---|
| `/m/workout` → tap a session | the exercise list, ordered as seeded |
| Each row | muscle group, `N sets • M reps`, a `0/3`-style pill |
| Tap an exercise | the detail screen, with sets/reps/rest matching the row |
| Back arrow on the detail screen | returns to that session, not to the plan |
| Bottom nav on both screens | Workout highlighted, never Home |
| A session with no exercises | renders the header and an empty list, no crash |

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/SessionDetailScreen.jsx src/features/workout/ExerciseDetailScreen.jsx src/routes/index.jsx
git commit -m "feat: add session detail and exercise detail screens"
```

---

## Task 12: Route-level code splitting

**Files:**
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: every screen module from tasks 5–11.
- Produces: nothing other modules import.

Phase 0 shipped one 669 KiB JavaScript chunk. The spec calls for `lazy()` per
section, and this is the last task of the phase because splitting a moving target
just makes the diffs noisy. React Router's data router takes a `lazy` property
per route and resolves it during navigation, which needs no `<Suspense>`
boundary of its own.

- [ ] **Step 1: Record the baseline**

Run: `npm run build`
Write down the reported precache size and the largest `dist/assets/*.js` file.
Expected before this task: a single chunk near 669 KiB.

- [ ] **Step 2: Convert the member and professional screens to `lazy`**

In `src/routes/index.jsx`, delete exactly these four import lines:

```js
import MemberHomeScreen from '../features/home/MemberHomeScreen.jsx'
import WorkoutPlanScreen from '../features/workout/WorkoutPlanScreen.jsx'
import SessionDetailScreen from '../features/workout/SessionDetailScreen.jsx'
import ExerciseDetailScreen from '../features/workout/ExerciseDetailScreen.jsx'
```

Keep these three — they are the first paint, and deferring them only buys an
extra round trip before anyone can log in:

```js
import LoginScreen from '../features/auth/LoginScreen.jsx'
import ForgotPasswordScreen from '../features/auth/ForgotPasswordScreen.jsx'
import ResetPasswordScreen from '../features/auth/ResetPasswordScreen.jsx'
```

The three auth routes stay exactly as they are. The four member routes become:

```js
      {
        index: true,
        lazy: async () => ({ Component: (await import('../features/home/MemberHomeScreen.jsx')).default }),
      },

      {
        path: 'workout',
        lazy: async () => ({ Component: (await import('../features/workout/WorkoutPlanScreen.jsx')).default }),
      },
      {
        path: 'workout/session/:sessionId',
        lazy: async () => ({ Component: (await import('../features/workout/SessionDetailScreen.jsx')).default }),
      },
      {
        path: 'workout/exercise/:sessionExerciseId',
        lazy: async () => ({ Component: (await import('../features/workout/ExerciseDetailScreen.jsx')).default }),
      },
```

Leave every remaining `screen('...')` placeholder route untouched — `Placeholder`
is a handful of bytes and splitting it would add a request per tap for no gain.

- [ ] **Step 3: Rebuild and compare**

Run: `npm run build`

Expected: several `dist/assets/*.js` chunks instead of one, the largest
noticeably smaller than the baseline from Step 1. The precache entry count rises
(each chunk is precached) while the total stays roughly the same — splitting
moves bytes between files, it does not delete them. The win is that a cold start
parses less.

Record both numbers; they belong in report chapter 5 as a before/after.

- [ ] **Step 4: Verify navigation still works**

Run: `npm run preview`, sign in, and walk `/m` → `/m/workout` → a session → an
exercise, then use the browser Back button all the way out.

Expected: every screen renders; DevTools → Network shows a new `.js` chunk
fetched on first visit to each section and nothing on repeat visits.

Then, with DevTools set to Offline, reload on `/m/workout`.

Expected: the screen still renders. If it does not, the chunk was not precached —
check that `globPatterns` in `vite.config.js` still includes `**/*.{js,css,html}`.
This is the one real risk in this task: lazy chunks that the service worker never
cached turn a working offline app into a blank screen.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/routes/index.jsx
git commit -m "perf: split member screens into lazy route chunks"
```

---

## Phase 1 Acceptance

Not a task — the human checks that close the phase.

- [ ] `npm run lint` exits 0.
- [ ] `node src/lib/format.selfcheck.js` prints `format: OK`.
- [ ] `node src/features/workout/status.selfcheck.js` prints `workout status: OK`.
- [ ] `npm run build && npm run preview`, then behind ngrok on the phone: sign in
      as the member, reach an exercise detail screen, put the phone in airplane
      mode, and reload — the screen still renders.
- [ ] DevTools → Application → IndexedDB → `keyval-store` → `keyval` holds
      `trainhub-query-cache` with the plan and appointment queries in it.
- [ ] Signing in as `andrea@trainhub.dev` still lands on `/p` and every
      professional route still shows its placeholder.
- [ ] Lighthouse re-run against `http://localhost:4173`; record the Performance
      score next to the Phase 0 one for chapter 5.

## Deferred to later phases

Named here so they are not mistaken for oversights:

- The `+` button on Home and Workout Plan (Phase 2, workout builder).
- The play button starts a live session (Phase 2).
- Set logging, and therefore any `loggedCount` above zero (Phase 2).
- Notification bell badge (Phase 4).
- Nutrition, Trainer, and every professional screen (Phases 3–4).
- A stalled profile fetch has no timeout, carried from Phase 0's review.
