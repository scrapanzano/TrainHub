# Phase 3 final-review fixes

Applied the ten findings from the whole-branch review of `phase-3-professional-side`. One section per finding below, then the exact verification commands and output.

## 1. `/p/calendar/availability` is unreachable

`src/features/calendar/CalendarScreen.jsx`: added an `IconButton` with `component={Link} to="/p/calendar/availability"` and `aria-label="Weekly availability"`, using the `Schedule` glyph from `@mui/icons-material` (confirmed present at `node_modules/@mui/icons-material/Schedule.js` before using it). Placed it in the header row directly after the expand/collapse `IconButton` and before the `flexGrow` spacer that separates the view controls from the month-navigation chevrons and the `+` Fab — so it reads as a calendar-settings affordance grouped with "how do I view this", not as a second thing competing with "book an appointment".

Also imported `Link` from `react-router` in the same file (added to the existing `useSearchParams` import).

## 2. Two edit-path writes are unscoped

`src/data/mutations.js`:
- `saveNutritionPlan`'s registered default now carries `scope: { id: 'nutritionPlan' }`, with a comment pointing at the same reasoning as `saveMeal` (two edits to the same plan replayed in parallel can let the older one win).
- `saveBodyMetric`'s registered default now carries `scope: { id: 'bodyMetric' }`, with a comment noting the upsert target is `(member_id, measured_on)`, so two saves for the same client on the same day hit the same row and must replay in order.

Both are on the registered defaults in `mutations.js`, not at any call site, per the finding (a call-site scope would not survive rehydration after reload).

## 3. `createPlan` has no idempotency key

`src/data/workouts.js`: `createPlan` now takes `id` as a parameter and does `.upsert(row, { onConflict: 'id', ignoreDuplicates: true }).select('id').maybeSingle()` instead of `.insert(...).select('id').single()`. Docstring updated to explain why (no unique constraint besides the PK, `fetchActivePlan` takes `created_at desc limit 1` so a duplicate is invisible, and both `retry: 3` and an offline resubmit-after-reload can produce one) and to explicitly say `ignoreDuplicates` is safe here because `createPlan` is insert-only, unlike `saveNutritionPlan`/`saveMeal` which are also the edit path.

`src/features/clients/ClientWorkoutScreen.jsx`: the `onSubmit` prop passed to `NewPlanForm` (around what was line 132) now reads:

```jsx
onSubmit={(values) =>
  // Generated here, in the submit handler, not during render: a
  // render-time `crypto.randomUUID()` call would be impure and
  // lint-detected. It is the idempotency key `createPlan` upserts
  // on, so a retried or replayed submit lands on the same row.
  createPlan.mutate({
    id: crypto.randomUUID(),
    memberId: clientId,
    authorId: user.id,
    ...values,
  })
}
```

**Why this is not a render-time impurity:** `crypto.randomUUID()` is called inside the arrow function passed as `NewPlanForm`'s `onSubmit` prop. That arrow function is *created* during render (as any JSX prop is), but its *body* — including the `crypto.randomUUID()` call — only executes later, when `NewPlanForm`'s own `<form onSubmit>` handler invokes it after the user submits. Render itself never calls it; nothing about the component's render output depends on it. This mirrors the pattern already established in `src/features/calendar/AvailabilityScreen.jsx`'s `add.mutate({ id: crypto.randomUUID(), ... })` inside its own form's `onSubmit`, and in `createAppointment`'s established call sites.

## 4. `ClientDetailScreen`'s overview cards show "Loading…" forever on error

`src/features/clients/ClientDetailScreen.jsx`: added a third branch to both the Workout Plan and Nutrition Plan `OverviewCard` bodies, checked *before* the `data === undefined` ("Loading…") branch so it takes priority once an error is known, and gated on `isError && data === undefined` (never `isError` alone) so a failed refetch that still has good cached data keeps showing that data instead of an error line — matching the `networkMode: 'offlineFirst'` convention documented in `ErrorState`.

Copy used, offline vs. online-error, worded to match `ErrorState`'s "You are offline" / "Something went wrong" convention while staying inline-sized:

- Workout Plan card:
  - Offline: `"You are offline. This will load once you reconnect."`
  - Online error: `"Could not load the workout plan. Tap to try again."`
- Nutrition Plan card:
  - Offline: `"You are offline. This will load once you reconnect."`
  - Online error: `"Could not load the nutrition plan. Tap to try again."`

"Tap to try again" is literally true and not decorative: the whole card is already a `CardActionArea` linking to `/p/clients/:clientId/workout` (or `/nutrition`), and both of those screens fetch the same query key and show their own `ErrorState` with a working `onRetry`. So the existing link *is* the retry affordance the finding says is enough — no separate button was added.

## 5. `supabase/verify.sql` reports four FAILs after patch 005

Added a comment block directly above the four affected rows (`profiles`, `workout_plans`, `workout_sessions`, `appointments`) in the "Seed contents" section, explaining:
- these four counts are the `seed.sql`-only baseline (fresh install, before any patch),
- they are deliberately *not* bumped to match `patches/005-demo-clients.sql`, because that would break the fresh-install-without-demo-data path — the reason the schema patch and the demo patch are separate files,
- what each count becomes after `patches/005-demo-clients.sql` has been run (2→6, 1→5, 4→16, 3→8), with a one-line reason for each,
- that `patches/005-demo-clients.sql` ends with its own PASS/FAIL block for the post-patch counts, and that block — not this file — is what to check once the demo data is loaded.

No expected values were changed.

## 6. `ClientProgressScreen` states something false while loading

`src/features/progress/ClientProgressScreen.jsx`: the loading gate

```js
if (training.isPending || metrics.isPending) return <LoadingState />
```

became

```js
// `plan` must gate the loading state too: while it is still in flight,
// `weeklyTraining` gets `0` for the target, which prints "No plan assigned"
// -- indistinguishable from a client who genuinely has none.
if (training.isPending || metrics.isPending || plan.isPending) return <LoadingState />
```

## 7. `CalendarScreen` prints a raw ISO date as a heading

`src/features/calendar/CalendarScreen.jsx`: imported `formatDate` alongside the existing `todayISO` import from `../../lib/format.js`, and changed

```jsx
<Typography variant="h2">{selected === todayISO() ? 'Today' : selected}</Typography>
```

to

```jsx
<Typography variant="h2">{selected === todayISO() ? 'Today' : formatDate(selected)}</Typography>
```

## 8. Member-side copy leaks into the professional shell

`src/components/OfflineBanner.jsx`: `'Offline — your workout still works'` became `'Offline — your changes are saved and will sync when you reconnect'`, which is true on `/m`, `/p`, `/p/clients` and `/p/calendar` alike (it no longer claims anything workout-specific, and it echoes the wording already used one branch up for the "N changes waiting" case).

## 9. `queryPrefixes.clients` is declared and never used

Chose the "prefer invalidating" option per the finding. `src/data/mutations.js`: `createPlan`'s registered `onSettled` now also invalidates `queryPrefixes.clients`, with a comment explaining that `fetchClients` derives each roster row's `goal` from the client's newest `workout_plans` row, so the roster goes stale the moment a plan is created unless this family is invalidated too. `queryPrefixes.clients` itself (declared in `src/lib/queryKeys.js`) was left as-is — it is now used, not dead.

## 10. Two dead/fragile lines in `AvailabilityScreen.jsx`

- Removed the `{ onSuccess: () => setWeekday(Number(weekday)) }` second argument from `add.mutate(...)` entirely, and added a comment above the (now single-argument) call explaining the form deliberately keeps its values after a save so a professional can add several slots to the same day in a row, and noting the removed code was a no-op dressed as a reset.
- Added a one-line comment above `const invalidRange = endsAt <= startsAt` naming the guarantee the lexicographic comparison relies on: `<input type="time">` always yields zero-padded 24-hour `'HH:MM'` values, which sort the same lexicographically as chronologically.

## Anything found while fixing that the review did not mention

- `createPlan`'s new `.maybeSingle()` (needed because `ignoreDuplicates` returns no row on a replay, exactly as `createAppointment`/`logSet` already document) means the mutation's resolved data is `undefined` on a replay rather than a plan row. No call site in this codebase reads `createPlan`'s resolved value (`ClientWorkoutScreen.jsx` relies on cache invalidation, not the mutation's return value), so this is safe, but worth flagging since a future caller that expects `{ id }` back unconditionally would be wrong to assume that.
- Initially wrote the `plan.isPending` gate comment in `ClientProgressScreen.jsx` using a JSX-style `{/* */}` comment, which is a syntax error outside JSX (the gate is a plain `if` statement above the `return`). Caught this before running lint/build and switched it to a normal `//` comment.

## Verification — commands and full output

### `npm run lint`

```
> trainhub@0.0.0 lint
> eslint .
```
Exit 0, no output, no `eslint-disable` added anywhere.

### `npm run build`

```
> trainhub@0.0.0 build
> vite build

vite v8.1.5 building client environment for production...
transforming...✓ 1152 modules transformed.
rendering chunks...
computing gzip size...
... (asset list omitted for length; nothing failed) ...
✓ built in 531ms

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
vite v8.1.5 building client environment for production...

WARN inlineDynamicImports option is deprecated, please use codeSplitting: false instead.

transforming...✓ 88 modules transformed.
rendering chunks...
computing gzip size...
dist/sw.mjs  23.31 kB │ gzip: 7.69 kB

✓ built in 50ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  63 entries (1100.26 KiB)
files generated
  dist/sw.js
```
Build succeeded (the `inlineDynamicImports` warning is pre-existing tooling noise from `vite-plugin-pwa`'s service-worker build step, unrelated to this change).

### Self-checks

```
$ node src/lib/format.selfcheck.js
format: OK
$ node src/features/calendar/month.selfcheck.js
month.selfcheck OK
$ node src/features/progress/progress.selfcheck.js
progress.selfcheck OK
$ node src/features/clients/subscription.selfcheck.js
subscription.selfcheck OK
```

All four printed their OK line.

## Files changed

- `src/features/calendar/CalendarScreen.jsx` (findings 1, 7)
- `src/data/mutations.js` (findings 2, 3, 9)
- `src/data/workouts.js` (finding 3)
- `src/features/clients/ClientWorkoutScreen.jsx` (finding 3)
- `src/features/clients/ClientDetailScreen.jsx` (finding 4)
- `supabase/verify.sql` (finding 5)
- `src/features/progress/ClientProgressScreen.jsx` (finding 6)
- `src/components/OfflineBanner.jsx` (finding 8)
- `src/features/calendar/AvailabilityScreen.jsx` (finding 10)

`.superpowers/sdd/progress.md` shows as modified in `git status` but was already modified before this task started (controller bookkeeping, not part of this change) — not staged or touched.
