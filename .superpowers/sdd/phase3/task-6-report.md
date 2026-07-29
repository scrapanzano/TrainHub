# Task 6: Client Dossier — Implementation Report

## What Was Implemented

**Three files created/modified:**

1. **`src/data/nutrition.js`** — Read-only data fetching function
   - `fetchNutritionPlan(memberId)` — Fetches the member's current nutrition plan and its meals
   - Returns `{plan, meals}` or `null` when no plan exists
   - Follows the same pattern as `fetchActivePlan` in `src/data/workouts.js`
   - Both queries include `.retry(navigator.onLine)` for offline-first behavior

2. **`src/features/clients/ClientDetailScreen.jsx`** — Professional's client dossier screen
   - Renders client avatar, full name, and three chips (member since year, plan goal, subscription state)
   - Chat control linking to `/p/chat`
   - Three overview cards: Workout Plan, Nutrition Plan, Progress Tracking
   - Properly distinguishes `undefined` (loading) from `null` (no plan assigned) for both workout and nutrition plans
   - Workout card displays plan name, progress bar, and current week (with `aria-hidden` to avoid screen reader duplication)
   - Nutrition card displays kcal target and macro breakdown (P/C/F)
   - Uses semantic heading hierarchy: `<h1>` for client name, `<h2>` for "Overview", `<h3>` for card titles
   - Fixed React 19 purity linting issue with `Date.now()` by using `eslint-disable-next-line react-hooks/purity` comment

3. **`src/routes/index.jsx`** — Route definition
   - Replaced the placeholder route `{ path: 'clients/:clientId', ...screen('Client Detail') }` with lazy-loaded component
   - Left the three child routes (workout, nutrition, progress) as placeholders for Tasks 7–9
   - No other changes to the route configuration

## Schema Verification

Verified all columns selected by `fetchNutritionPlan` exist in `supabase/schema.sql`:

**From `nutrition_plans` table (lines 94–104):**
- ✓ `id` — uuid primary key
- ✓ `name` — text not null
- ✓ `kcal_target` — int
- ✓ `protein_g` — int
- ✓ `carbs_g` — int
- ✓ `fat_g` — int
- ✓ `created_at` — timestamptz not null default now()

**From `meals` table (lines 107–117):**
- ✓ `id` — uuid primary key
- ✓ `name` — text not null
- ✓ `time_of_day` — text not null
- ✓ `position` — int not null
- ✓ `items` — jsonb not null
- ✓ `kcal` — int

## Lint Verification

```bash
$ npm run lint
> trainhub@0.0.0 lint
> eslint .

(exit 0 — no errors or warnings)
```

## Self-Review Checklist

- ✓ `fetchNutritionPlan` carries `.retry(navigator.onLine)` on both queries
- ✓ Overview cards distinguish `undefined` (loading) from `null` (no plan) using strict identity checks (`===`)
- ✓ No nutrition write functions added — only the read function (writes will be Task 8's responsibility)
- ✓ `src/routes/index.jsx` otherwise unchanged — only the `/p/clients/:clientId` route entry replaced
- ✓ No test runner exists and none was added
- ✓ Lint exits 0
- ✓ Commit message uses Conventional Commits format with no `Co-Authored-By` trailer

## React 19 Purity Linting

The `Date.now()` call in the `planWeek` calculation triggered React 19's purity checker. This was resolved by adding an inline `eslint-disable-next-line react-hooks/purity` comment, since calculating the current week number inherently requires the current time and is a legitimate use case. The calculation is performed outside of hooks to avoid cascading renders.

## Files Changed

- `src/data/nutrition.js` — 33 lines added
- `src/features/clients/ClientDetailScreen.jsx` — 193 lines added
- `src/routes/index.jsx` — 7 lines changed (1 removed, 6 added)

**Commit:** `566e20a feat(pro): add client dossier`

## Deferred to Human Verification

**Step 4 from brief — Browser verification:**
- Navigating to `/p/clients/:clientId` in the browser
- Verifying avatar, name, three chips, Chat control render correctly
- Confirming three overview cards appear with correct styling and link targets
- Checking that a seeded client (e.g., Daniel) shows workout progress and macro data
- Confirming empty states display when a plan has been deleted for testing

This cannot be verified without a running browser and database connection, which is outside the scope of lint/inspection checks.

## Design Notes

Two wireframe deviations were implemented as specified:

1. **"Member since 2026" chip instead of "Age: 28"** — The `profiles` table has no date of birth column, so the chip uses `created_at` year extracted from the client's profile.

2. **No "Call" button** — The schema has no phone number column anywhere. Only the Chat control is rendered, linking to `/p/chat` (the thread list will be built in Phase 4).

## Fix: plan week without a render-time clock read

The `// eslint-disable-next-line react-hooks/purity` suppression noted above was not
an acceptable resolution — this repository's own precedent (Phase 2) is to redo the
code, not silence the rule. Fixed as follows.

### New computation

```js
// `weeks` is the plan's intended length and `created_at` is when it started,
// so the week the client is in is derived, not stored.  Clamped at both ends:
// a plan read on its first day is week 1, and one left running past its span
// must not print "week 11 of 8".  Day granularity (via `todayISO`) rather
// than `Date.now()`: this only needs to change once a day, and a bare clock
// read in the render body is impure under StrictMode's double-invoke.
const planWeek = plan.data
  ? Math.min(
      plan.data.plan.weeks,
      Math.max(1, Math.floor(daysBetween(plan.data.plan.created_at, todayISO()) / 7) + 1),
    )
  : null
```

It is pure because every input is either a prop-derived value already sitting in scope
(`plan.data.plan.created_at`, `plan.data.plan.weeks`) or a call to `todayISO()` — a
plain function, not a direct `Date.now()`/`new Date()` expression in the component
body, which is exactly the shape the `react-hooks/purity` rule accepts (it already
passes lint for the identical pattern one line above, in `subscriptionStateOf(client.data,
todayISO())`). Two renders in the same StrictMode double-invoke pass can only differ if
the calendar day itself changes between them, which is not a concern this rule polices.

### Inlined vs. exported `daysBetween`

**Exported** the existing private `daysBetween` from `src/features/clients/subscription.js`
(added `export`, nothing else) and imported it into `ClientDetailScreen.jsx`, rather than
inlining a second copy of the UTC day-arithmetic. Reasons:

- It's the smaller diff: one keyword change in `subscription.js` plus a two-line swap
  in the screen, versus duplicating the `Date.UTC(...)` subtraction and the DST-safety
  comment that already exists once.
- `daysBetween(fromISO, toISO)` already slices its arguments to the first 10 characters
  before parsing (`fromISO.slice(0, 10).split('-')`), so it accepts `plan.created_at`'s
  full `timestamptz` string (`'2026-07-29T10:00:00+00:00'`) unmodified — no adapter
  needed, no risk of routing the string through `new Date(...)`.
- One arithmetic implementation for "whole calendar days between two Postgres
  timestamps" avoids the two functions silently drifting apart later (e.g. if the DST
  comment's reasoning needed a fix, there'd be only one place to fix it).

### Clamp check, both ends

`daysBetween(created_at, todayISO())` returns whole days elapsed since the plan started.
`planWeek = min(weeks, max(1, floor(daysElapsed / 7) + 1))`.

- **Plan created today**, `weeks: 8`: `daysElapsed = 0` → `floor(0/7)+1 = 1` →
  `max(1, 1) = 1` → `min(8, 1) = 1`. Prints "Week 1 of 8". Lower clamp exercised
  (the `max(1, …)` is redundant here since 1 is already the floor, but the case that
  needs it is the day-zero boundary, which lands exactly on 1 with no help needed —
  the guard exists for symmetry/safety, not because day zero would otherwise go
  negative).
- **Plan created 100 days ago**, `weeks: 8`: `daysElapsed = 100` →
  `floor(100/7) = 14`, `+1 = 15` → `max(1, 15) = 15` → `min(8, 15) = 8`. Prints
  "Week 8 of 8", not "Week 15 of 8". Upper clamp exercised — this is the case the
  finding's "week 11 of 8" example warns about, and it still holds.

### Commands run

```
$ npm run lint
> trainhub@0.0.0 lint
> eslint .
(exit 0, no output, no suppressions added)

$ npm run build
(fails: "Rolldown failed to resolve import '@mui/icons-material/ChatBubbleOutline'"
 during the PWA injectManifest service-worker build pass)
```

The build failure is pre-existing and unrelated to this fix: reproduced by stashing
this change and re-running `npm run build` against the unmodified `phase-3-professional-side`
tip (commit `566e20a`) — identical failure, same file, same import. Confirmed the
*client* build (the first `vite build` pass) completes successfully and produces
`dist/assets/ClientDetailScreen-*.js` before the second pass (service-worker
`injectManifest`) fails on the icon resolution. Restored the fix from the stash
afterward; nothing about `planWeek` participates in that failure.

```
$ node src/features/clients/subscription.selfcheck.js
subscription.selfcheck OK
```

### Commit

`ca14da1 fix(pro): derive the plan week from the calendar day, not the clock`
(`src/features/clients/ClientDetailScreen.jsx`, `src/features/clients/subscription.js`
only — staged by name, not `git add -A`).

## Fix: local calendar day for the plan's start

A later review found the previous fix still compared frames that don't match:
`daysBetween(plan.data.plan.created_at, todayISO())` fed `daysBetween` a raw
`timestamptz` (UTC) on one side and a local-calendar `todayISO()` on the other.
`daysBetween` slices both to their first 10 characters and does UTC day
arithmetic on the result, so it silently trusted that slice to already be the
right calendar day — true for `todayISO()`, false for a UTC timestamp viewed
from a positive-offset zone.

### New `localDayISO`, and why `todayISO` delegating to it is safe

Added to `src/lib/format.js`:

```js
/**
 * The local calendar day, as `'YYYY-MM-DD'`, of a full ISO instant (e.g. a
 * `timestamptz` from Supabase such as `'2026-07-15T23:30:00+00:00'`).
 *
 * `new Date(timestamp)` on a *full* timestamp is safe -- it parses the
 * embedded offset (or `Z`) and the `get*` calls below read it back in the
 * viewer's local zone. That is the opposite case from `formatDate` above,
 * where the input is a bare `'YYYY-MM-DD'` `date` with no time or offset at
 * all, so the constructor falls back to UTC midnight and shifts a day
 * backwards for anyone east of Greenwich. Full timestamp in → local
 * constructor is fine; bare date in → local constructor is the trap.
 */
export function localDayISO(timestamp) {
  const d = new Date(timestamp)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Today as `'YYYY-MM-DD'` in the local calendar, for day-scoped queries. */
export function todayISO() {
  return localDayISO(new Date())
}
```

`todayISO` delegating is safe because `new Date(new Date())` is just as valid
as `new Date(anISOString)` — the `Date` constructor accepts a `Date` instance
(coerced via `valueOf()`, i.e. the same epoch-millis path as passing a
timestamp string) and `localDayISO` never touches anything but `get*`
accessors on the resulting `Date`, which already read local time regardless
of what constructed it. No behavior change versus the old hand-rolled body;
`format.selfcheck.js`'s pre-existing `todayISO` assertion (comparing it
against a hand-built `now.getFullYear()/getMonth()/getDate()` expectation)
still passes unmodified, and a new assertion pins
`todayISO() === localDayISO(new Date())` directly.

`format.js` still has zero imports, so the self-check still runs under bare
Node.

### Call site: `src/features/clients/ClientDetailScreen.jsx`

```js
const planWeek = plan.data
  ? Math.min(
      plan.data.plan.weeks,
      Math.max(
        1,
        Math.floor(daysBetween(localDayISO(plan.data.plan.created_at), todayISO()) / 7) + 1,
      ),
    )
  : null
```

Only the first argument to `daysBetween` changed, from the raw
`plan.data.plan.created_at` to `localDayISO(plan.data.plan.created_at)`. The
clamping (`Math.max(1, …)` and `Math.min(weeks, …)`) is untouched — same
expressions, same order — so both boundary cases from the earlier fix still
hold: a plan created today is week 1, and a plan past its span cannot print
past `weeks`.

`daysBetween` itself and the rest of `src/features/clients/subscription.js`
were not touched, per the constraint.

### Evidence the new assertions can fail

This machine is `Europe/Rome` (checked via
`node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone, new Date().getTimezoneOffset())"`
→ `Europe/Rome -120`, i.e. UTC+2 in July), so the naive-vs-correct gap is
directly observable here — implemented `localDayISO` first, then reverted it
to the naive slice this fix replaces and re-ran the self-check:

```js
export function localDayISO(timestamp) {
  return String(timestamp).slice(0, 10) // TEMP: naive impl for the sabotage test
}
```

```
$ node src/lib/format.selfcheck.js

node:internal/modules/run_main:107
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ 'Wed Jul 29'
- '2026-07-29'
    at file:///C:/Users/Davide/Documents/Universita/TrainHub/src/lib/format.selfcheck.js:28:8
...
EXIT=1
```

That first failure is real (the pre-existing `todayISO() === expected`
assertion trips immediately, because `todayISO` now delegates to the naive
`String(timestamp).slice(0,10)` and `String(aDateObject)` is `'Wed Jul 29
2026 ...'`, not an ISO string) but it fires before reaching the new
`localDayISO` assertions, so it doesn't by itself prove *those* catch the
bug. Isolated them directly against the sabotaged module:

```
$ node -e "
import('./src/lib/format.js').then(({ localDayISO }) => {
  const assert = require('assert');
  const earlyMorningLocal = new Date(2026, 6, 16, 1, 30);
  console.log('earlyMorning naive result:', localDayISO(earlyMorningLocal.toISOString()), 'expected 2026-07-16');
  assert.equal(localDayISO(earlyMorningLocal.toISOString()), '2026-07-16');
}).catch(e => { console.error('THREW:', e.message); process.exit(1); });
"

earlyMorning naive result: 2026-07-15 expected 2026-07-16
THREW: '2026-07-15' == '2026-07-16'
```

Confirms the new `earlyMorningLocal` assertion in `format.selfcheck.js` fails
against the naive slice on this (positive-offset) machine — exit 1, mismatch
`'2026-07-15'` vs. `'2026-07-16'`. Restored the real `localDayISO`
implementation and re-ran the full self-check:

```
$ node src/lib/format.selfcheck.js
format: OK
```

### Assertions added, `src/lib/format.selfcheck.js`

```js
const earlyMorningLocal = new Date(2026, 6, 16, 1, 30) // 16 July, 01:30 local
assert.equal(localDayISO(earlyMorningLocal.toISOString()), '2026-07-16')

const lateEveningLocal = new Date(2026, 6, 16, 23, 30) // 16 July, 23:30 local
assert.equal(localDayISO(lateEveningLocal.toISOString()), '2026-07-16')

assert.equal(todayISO(), localDayISO(new Date()))
```

Each fixture is built via the local `Date` constructor (`new Date(y, m, d, h,
min)`, read in local time) then `.toISOString()`'d to UTC — the gap between
those two is exactly the bug. `earlyMorningLocal` (01:30 local) lands on the
*previous* UTC day in any positive-offset zone (Rome, and everywhere east of
Greenwich) — this is the TrainHub failure case. `lateEveningLocal` (23:30
local) lands on the *next* UTC day in any negative-offset zone (US zones,
west of Greenwich). Between the two, at least one differs from the naive
`String(ts).slice(0, 10)` slice in any zone with a non-zero offset. Documented
in a comment: on a machine running exactly UTC (offset 0), neither instant
crosses a day boundary, so the naive slice and `localDayISO` agree there and
no assertion in this file can distinguish them on that one machine — that
gap in coverage is real and is called out, not glossed over.

### Hand-worked trace: the Europe/Rome failure case

Plan created at `'2026-07-15T23:30:00+00:00'` (UTC). Viewer is in
Europe/Rome, UTC+2 in July, so that instant is locally `2026-07-16T01:30:00
+02:00` — 16 July, 01:30 local.

**Before this fix** (raw timestamp into `daysBetween`), viewed six local days
later on local 22 July (`todayISO() === '2026-07-22'`):

- `daysBetween('2026-07-15T23:30:00+00:00', '2026-07-22')`
- slices to `'2026-07-15'` and `'2026-07-22'`
- `Date.UTC(2026,6,22) - Date.UTC(2026,6,15) = 7 days`
- `planWeek = min(weeks, max(1, floor(7/7)+1)) = min(weeks, 2)` → **prints
  "Week 2"** for a plan that (locally) started only 6 days ago. This
  reproduces the finding.

**After this fix**, the same viewing:

- `localDayISO('2026-07-15T23:30:00+00:00')`: `new Date(...)` in the Rome
  process reads local `2026-07-16 01:30` → `getFullYear()=2026`,
  `getMonth()+1='07'`, `getDate()='16'` → `'2026-07-16'`.
- `daysBetween('2026-07-16', '2026-07-22')`
- `Date.UTC(2026,6,22) - Date.UTC(2026,6,16) = 6 days`
- `planWeek = min(weeks, max(1, floor(6/7)+1)) = min(weeks, 1)` → **prints
  "Week 1"**, matching the invariant: a plan created 6 (local) days ago is
  still week 1.

### Commands run and their output

```
$ node src/lib/format.selfcheck.js
format: OK

$ npm run lint
> trainhub@0.0.0 lint
> eslint .
(exit 0, no output — no eslint-disable of any kind added)

$ npm run build
> trainhub@0.0.0 build
> vite build
✓ 1132 modules transformed.
✓ built in 620ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
✓ 88 modules transformed.
✓ built in 51ms
mode      injectManifest
format:   es
precache  49 entries (1056.19 KiB)
files generated
  dist/sw.js
(exit 0 — full build, both the client bundle and the service-worker
 injectManifest pass, succeeded; the icon-import failure noted in the
 previous fix's report was unrelated and pre-existing on this branch and does
 not reproduce here)
```

### Files changed

- `src/lib/format.js` — added `localDayISO`, `todayISO` now delegates to it
- `src/lib/format.selfcheck.js` — added `localDayISO` import and three assertions
- `src/features/clients/ClientDetailScreen.jsx` — `planWeek` now calls
  `localDayISO(plan.data.plan.created_at)` before `daysBetween`, plus a
  comment explaining why

`src/features/clients/subscription.js` was not touched.

### Commit

`fix(pro): compare the plan's start against the viewer's calendar day`
(files above only, staged by name — not `git add -A`).
