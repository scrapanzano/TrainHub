# Task 8 Report: Nutrition plan editor

## What I implemented

Transcribed the brief exactly, no deviations:

1. **`src/data/nutrition.js`** — appended `saveNutritionPlan`, `saveMeal`, `deleteMeal` after the existing `fetchNutritionPlan` (unchanged).
2. **`src/lib/mutationKeys.js`** — added `saveNutritionPlan`, `saveMeal`, `deleteMeal` keys.
3. **`src/data/mutations.js`** — imported the three writes from `./nutrition.js` and registered them via `setMutationDefaults`, appended after the existing `deleteSession` registration. `saveMeal` and `deleteMeal` share `scope: { id: 'meals' }`.
4. **`src/features/nutrition/NutritionPlanEditorScreen.jsx`** (new file, new directory) — `PlanHeaderForm`, `MealCard`, `NumberField`, `toNumberOrNull`, and the default-exported `NutritionPlanEditorScreen`.
5. **`src/routes/index.jsx`** — replaced the `clients/:clientId/nutrition` placeholder with a lazy route to the new screen. `clients/:clientId/progress` left untouched as a placeholder for Task 9.

## Columns checked against `supabase/schema.sql`

- `nutrition_plans` (lines 94-104): `id, member_id, author_id, name, kcal_target, protein_g, carbs_g, fat_g, created_at`. `saveNutritionPlan` writes `member_id, author_id, name, kcal_target, protein_g, carbs_g, fat_g` (+ `id` when present) — all exist.
- `meals` (lines 107-117): `id, plan_id, name, time_of_day (text not null), position (int not null), items (jsonb not null default '[]'), kcal`, with `unique (plan_id, position)`. `saveMeal` writes `plan_id, name, time_of_day, position, kcal, items` (+ `id` when present) — all exist, types match (`items` defaults to `[]` when not supplied, matching the not-null jsonb column).
- `fetchNutritionPlan` in `src/data/nutrition.js` — confirmed byte-identical to what Task 6 produced; only new code was appended below it.

## Commands run

- `npm run lint` → exit 0, no output (clean).
- `npm run build` → succeeded. Vite client build (1135 modules) and the `injectManifest` service-worker build both completed; `NutritionPlanEditorScreen-nZ_Scy-6.js` (5.64 kB) emitted as its own chunk. `Add` and `DeleteOutlined` icons resolved fine (both already confirmed present under `node_modules/@mui/icons-material/` before writing the file).

## Files changed

- `src/data/nutrition.js` (modified)
- `src/lib/mutationKeys.js` (modified)
- `src/data/mutations.js` (modified)
- `src/features/nutrition/NutritionPlanEditorScreen.jsx` (new)
- `src/routes/index.jsx` (modified)

## Self-review findings

- All three writes registered in `src/data/mutations.js` via `setMutationDefaults`, keyed off `mutationKeys.*`. Confirmed with `git show`/grep.
- `saveMeal` and `deleteMeal` share `scope: { id: 'meals' }` — set on the registered defaults, not at any call site.
- No call site passes `onSettled` to `useMutation`; the only `useMutation` calls in the screen are bare `{ mutationKey: ... }`. `mutate(vars, { onSuccess })` is used once (implicitly via `onSave`/`onDelete` callbacks — actually not even that; the screen never calls `mutate` with a second options argument at all).
- New meal's `position` computed as `Math.max(0, ...meals.map((meal) => meal.position)) + 1` — grep-verified.
- Empty numeric fields go through `toNumberOrNull`, which returns `null` for `''`/`null`, used for kcal/macros in both `PlanHeaderForm` and `MealCard`.
- `PlanHeaderForm` is rendered with `key={plan?.id ?? 'new'}`.
- Nothing added beyond the brief — file contents transcribed verbatim.

## Browser checks deferred to the human

Per the brief's Step 5, these require a running app + Supabase and cannot be done in this environment:

1. Open Daniel's nutrition plan as Coach Andrea; expect "Lean Bulk", 2600 kcal, three macros, four meal cards with items.
2. Change the calorie target, save, reload, confirm it persisted.
3. Add an item to Breakfast, save, confirm it appears.
4. Add a meal, delete it, add another — confirms the position-collision guard works end to end.
5. Open Lorenzo (no nutrition plan): expect empty header form + "No plan yet"; creating the plan should reveal the meals section.

## Git

Staged exactly: `src/data/nutrition.js src/data/mutations.js src/lib/mutationKeys.js src/features/nutrition src/routes/index.jsx` (not `.superpowers/sdd/progress.md`, which was locally modified as controller bookkeeping and left untouched).

## Fix: client-generated ids for the nutrition writes

### The bug

`saveNutritionPlan` and `saveMeal` only set `row.id` when the caller passed one (`if (id) row.id = id`). On the create path — no `id` — the insert let the `id` column default generate a fresh UUID. `queryClient.js` sets `retry: 3` on mutations by default, so if a create request commits on the server but its response is lost, TanStack Query re-runs the *same* `mutationFn`, which re-inserts with no `id` again and gets a *second* fresh UUID: a genuine second row. `meals` has `unique (plan_id, position)`, so that retry at least fails loudly; `nutrition_plans` has no such constraint, so the duplicate is silent, and `fetchNutritionPlan`'s `order('created_at', desc).limit(1)` means nobody ever sees the orphan.

### The fix

`saveNutritionPlan` and `saveMeal` (`src/data/nutrition.js`) now always write `row.id = id` — no `if (id)` guard — and every caller supplies one. The upsert stays a plain `onConflict: 'id'` with no `ignoreDuplicates`, so an edit (existing `id`) still updates the row; only the *value* the caller passes for `id` differs between create and edit.

### Call sites changed (`src/features/nutrition/NutritionPlanEditorScreen.jsx`)

1. **Plan header form submit** (`onSave` prop passed to `PlanHeaderForm`, ~line 243-254):
   ```js
   onSave={(values) =>
     savePlan.mutate({
       id: plan?.id ?? crypto.randomUUID(),
       memberId: clientId,
       authorId: user.id,
       ...values,
     })
   }
   ```
   Existing plan → keeps `plan.id`. No plan yet (creating) → `crypto.randomUUID()`.

2. **"Add a meal" button** `onClick` (~line 298-309):
   ```js
   saveMealMutation.mutate({
     id: crypto.randomUUID(),
     planId: plan.id,
     name: 'New meal',
     ...
   })
   ```
   Always a brand-new meal, so always a fresh id.

3. **`MealCard`'s own submit handler** (unchanged, already correct) — `onSave({ id: meal.id, ... })` inside `MealCard`, forwarded by the parent's `onSave={(values) => saveMealMutation.mutate({ planId: plan.id, ...values })}`. This is the edit path for an existing meal and was already passing the row's real id; nothing needed to change here.

### Confirmation that editing still works

Walk-through for "professional edits an existing meal's name and saves":

1. `MealCard` is rendered for a row already in `meals`, so `meal.id` is the real database UUID (not generated client-side — it either came from the database's original insert default for meals created before this fix, or from a previous `crypto.randomUUID()` create for meals created after it; either way it is a stable UUID already used as the row's primary key).
2. The user edits the `name` field (local `useState`, not yet saved) and submits. `MealCard`'s form `onSubmit` calls `onSave({ id: meal.id, name, timeOfDay: time, position: meal.position, kcal: ..., items: ... })` — `id: meal.id` is the existing id, never regenerated.
3. The screen's `onSave={(values) => saveMealMutation.mutate({ planId: plan.id, ...values })}` merges in `planId` and calls `mutate` with `id` still equal to `meal.id`.
4. `saveMeal` builds `row = { id: meal.id, plan_id, name: <new name>, ... }` and calls `.from('meals').upsert(row, { onConflict: 'id' })`. Postgres sees a conflict on the existing primary key and executes the upsert's `DO UPDATE`, setting `name` (and the other columns) to the new values on the *same* row. No `ignoreDuplicates` is set, so this is a real update, not a no-op — the new name is written and returned by `.select('id, name, time_of_day, position, items, kcal').single()`.
5. If the response for this same request were lost and TanStack Query retried, the retry calls `saveMeal` again with the identical `id: meal.id` and identical `name`, which upserts the same values onto the same row again — idempotent, no visible effect, no duplicate row, no constraint violation.

So edits still update in place; only creates changed behavior (id now supplied by the client instead of left to the database default).

### Where `crypto.randomUUID()` is called, and why it is not a render-time impurity

Both new calls are inside arrow-function *bodies* passed as `onSave`/`onClick` handler props (`PlanHeaderForm`'s `onSave` callback, and the "Add a meal" button's `onClick`). Defining the arrow function happens during render, but the function *body* — including the `crypto.randomUUID()` call — only executes when the user actually submits the form or clicks the button, i.e. inside a browser event handler, never as part of the render pass itself. This is the same shape as the existing `id: crypto.randomUUID()` call in `src/features/workout/LogSetSheet.jsx`'s `onSubmit` handler, which was used as the precedent for this fix. `react-hooks/purity` did not flag either call, and lint passed with no `eslint-disable` added.

### Commands run and output

```
$ npm run lint
> trainhub@0.0.0 lint
> eslint .
(exit 0, no output)

$ npm run build
> trainhub@0.0.0 build
> vite build
...
transforming...✓ 1135 modules transformed.
...
✓ built in 668ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
...
✓ built in 73ms
PWA v1.3.0
mode      injectManifest
format:   es
precache  56 entries (1074.08 KiB)
files generated
  dist/sw.js
(exit 0, build succeeded)
```

### Git

Staged only `src/data/nutrition.js` and `src/features/nutrition/NutritionPlanEditorScreen.jsx` (not `.superpowers/sdd/progress.md`, left untouched as controller bookkeeping). Commit:

```
d1ee4b5 fix(pro): give nutrition writes a client-generated id so a retry cannot duplicate
```
