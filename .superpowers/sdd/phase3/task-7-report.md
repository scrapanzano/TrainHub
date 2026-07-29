# Task 7 report: Workout plan editor

## What I implemented

1. **`src/data/workouts.js`** — appended `createPlan({memberId, authorId, name, goal, level, weeks}) -> {id}` and `deleteSession({sessionId}) -> void`, transcribed verbatim from the brief. Verified every column against `supabase/schema.sql` (`workout_plans`: member_id, author_id, name, goal, level, weeks; `workout_sessions`: delete by id) and the RLS gate (`owns_member` / `workout_plans_write`) against `supabase/policies.sql`.

2. **`src/lib/mutationKeys.js`** — added `createPlan: ['createPlan']` and `deleteSession: ['deleteSession']`.

3. **`src/data/mutations.js`** — imported `createPlan` and `deleteSession` from `./workouts.js`, registered both via `setMutationDefaults`:
   - `createPlan` invalidates `queryPrefixes.plan` on settle.
   - `deleteSession` invalidates `queryPrefixes.plan` and `queryPrefixes.session` on settle.
   Neither call site (`ClientWorkoutScreen.jsx`) passes `onSettled` — only per-call `mutate(vars, { onSuccess })`, which is additive and safe.

4. **`src/features/workout/SessionForm.jsx`** — new file, the extracted shared form (name field, exercise autocomplete, row list with sets/reps, offline/error alerts, submit button). Pure props: `catalogue`, `onSubmit`, `pending`, `paused`, `error`, `submitLabel`. Owns only its own draft state (`name`, `rows`, `picked`).

5. **`src/features/workout/WorkoutBuilderScreen.jsx`** — rewritten to fetch `plan`/`catalogue`, gate loading/error/empty states, then render `<SessionForm>` with the `create` mutation wired through `onSubmit`.

6. **`src/features/clients/ClientWorkoutScreen.jsx`** — new file. Fetches `client`, `plan`, `catalogue`. When `plan.data === null`, shows `NewPlanForm` (local component: name/goal/level/weeks, wired to `createPlan`). Otherwise renders the plan header, the session list (name, exercise count, status via `sessionStatusOf`, delete `IconButton` with a `window.confirm` guard), a `Divider`, and either an "Add a session" button or the mounted `SessionForm` (gated on `catalogue.data`) wired to `createSession`.

7. **`src/routes/index.jsx`** — replaced the `clients/:clientId/workout` placeholder with a `lazy` route loading `ClientWorkoutScreen.jsx`. `/nutrition` and `/progress` placeholders left untouched.

All six files were transcribed exactly from the brief; no reformatting or "improvement" beyond what the brief specified.

## `WorkoutBuilderScreen` rewrite: behaviour-by-behaviour comparison

| Behaviour | Original | Rewritten | Survived? |
|---|---|---|---|
| Catalogue gate before Autocomplete mounts | `catalogue.isError && catalogue.data === undefined` returns `ErrorState` before render; `catalogue.isPending` covered by the shared `LoadingState` branch | Identical gate, same comment about `useAutocomplete`/`options.filter()` | Yes |
| `plan` error/pending gates | Same shape | Same shape | Yes |
| Empty-plan state | `EmptyState` "No plan to add to" | Identical copy | Yes |
| `position` computation | `Math.max(0, ...plan.data.sessions.map(s => s.position)) + 1` | Identical, same comment | Yes |
| Mutation registration | `useMutation({ mutationKey: mutationKeys.createSession })`, no inline `mutationFn`, no `onSettled` at call site | Same | Yes |
| Offline "Saved offline" label | Local `savedOffline = create.isPending && create.isPaused`, passed into button label and Alert | Now computed inline as `paused={create.isPending && create.isPaused}` prop into `SessionForm`, which does the same label logic (`paused ? 'Saved offline' : pending ? 'Saving…' : submitLabel`) | Yes |
| Error Alert | `create.isError` → `create.error?.message ?? 'The session could not be saved. Try again.'` | `SessionForm` receives `error={create.error}` and renders `{error.message ?? 'The session could not be saved. Try again.'}` when `error` is truthy — same fallback, same trigger condition (an `Error` object is always truthy so this is equivalent to `isError`) | Yes |
| Navigate on success | `{ onSuccess: () => navigate('/m/workout', { replace: true }) }` passed to `create.mutate` | Identical, in `onSubmit` now defined in the screen and passed to `SessionForm`'s `onSubmit` prop | Yes |
| Row add/update/remove logic | Local handlers in the screen | Moved into `SessionForm`, byte-for-byte identical logic | Yes (relocated, not altered) |
| One `<h1>` | `<Typography variant="h1">New session</Typography>` inside the form Stack | Same text, now a sibling of `<SessionForm>` in the screen's own Stack | Yes |

No behaviour was dropped. The only structural change is that the `<h1>` and the `<form>` are no longer the same Stack — the screen now wraps `<Typography variant="h1">` and `<SessionForm>` in its own `<Stack sx={{ p: 2 }}>`, while `SessionForm` renders its own inner `<Stack component="form">`. This matches the brief exactly and preserves the padding/spacing visually.

## Commands run

```
npm run lint
> trainhub@0.0.0 lint
> eslint .
(exit 0, no output)

npm run build
> trainhub@0.0.0 vite build
✓ 1134 modules transformed, built in 597ms
PWA v1.3.0 — service worker built, 53 entries precached
✓ built in 60ms
(exit 0)
```

Both commands succeeded. New chunks `SessionForm-DtBzIM_e.js`, `WorkoutBuilderScreen-Br_RMqjm.js`, and `ClientWorkoutScreen-Bupr_zLB.js` appear in the build output, confirming the icon import (`@mui/icons-material/DeleteOutlined`) resolved and the lazy route split correctly.

## Files changed

```
 src/data/mutations.js                         |  17 +-
 src/data/workouts.js                          |  38 ++++
 src/features/clients/ClientWorkoutScreen.jsx  | 253 ++++++++++++++++++++++++++ (new)
 src/features/workout/SessionForm.jsx          | 169 +++++++++++++++++ (new)
 src/features/workout/WorkoutBuilderScreen.jsx | 163 ++---------------
 src/lib/mutationKeys.js                       |   2 +
 src/routes/index.jsx                          |   7 +-
 7 files changed, 502 insertions(+), 147 deletions(-)
```

Commit: `4519c53` — "feat(pro): add workout plan editor" (no Co-Authored-By trailer, per instructions).

`git show --stat HEAD` confirms exactly these seven files, nothing from `.superpowers/` bookkeeping was swept in (`.superpowers/sdd/progress.md` remains unstaged/untouched by this commit).

## Self-review findings

- **Member builder behaviour**: fully preserved, see table above. No regressions found.
- **Both new mutations registered in `mutations.js`**: yes — `createPlan` and `deleteSession`, both via `setMutationDefaults` with `mutationFn` pointing at the real exported function (not inline).
- **No call site passes `onSettled`**: confirmed by inspection of `ClientWorkoutScreen.jsx` and `WorkoutBuilderScreen.jsx` — both only use per-call `mutate(vars, { onSuccess })`.
- **`position` computed with `Math.max(0, ...)`, not `length + 1`, in both screens**: confirmed in `WorkoutBuilderScreen.jsx` (`Math.max(0, ...plan.data.sessions.map(...))+1`) and `ClientWorkoutScreen.jsx` (`Math.max(0, ...sessions.map(...))+1`).
- **`catalogue.data` gated before `SessionForm` mounts, in both screens**: `WorkoutBuilderScreen.jsx` returns early via the shared `catalogue.isPending`/`isError` gates before any JSX with `SessionForm` is reached; `ClientWorkoutScreen.jsx` explicitly gates with `{catalogue.data ? <SessionForm .../> : null}` inside the `adding` branch, plus its own pending/error rendering above it.
- **Nothing added beyond the brief**: only the seven named files were touched, and each file's contents match the brief's code blocks exactly (transcribed, not rewritten).
- Verified every table/column touched (`workout_plans.member_id/author_id/name/goal/level/weeks`, `workout_sessions` delete-by-id cascade) exists in `supabase/schema.sql`, and the `owns_member`/`workout_plans_write` policy referenced in the `createPlan` docstring exists in `supabase/policies.sql`.
- Confirmed `@mui/icons-material/DeleteOutlined.js` exists in `node_modules` before relying on the import (brief's warning about unresolved icons).

## Browser checks deferred to the human

No browser or database available in this environment. Per the brief's Step 7, these need manual verification:

1. As Coach Andrea, open a client's Workout Plan (`/p/clients/:clientId/workout`) — expect the plan header and its sessions with an exercise count and status.
2. Add a session with two exercises; confirm it appears in the professional's list and the client's own `/m/workout` shows it too.
3. Delete a session; confirm the `window.confirm` prompt names the session and the list loses the row after confirming.
4. Regression check: as Daniel (member), open `/m/workout/builder` and save a session — confirm the extracted `SessionForm` behaves exactly as before (offline "Saved offline" label, error Alert, navigate-on-success to `/m/workout`).
