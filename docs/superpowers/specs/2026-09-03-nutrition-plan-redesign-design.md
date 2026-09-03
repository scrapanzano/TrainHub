# Nutrition plan: Day Types, secure writes, and read/replace parity with Workout Plan

## Context

`doc/nutrition_plan.md` (Davide) audits the current Nutrition Plan feature
and finds it structurally behind Workout Plan in every way that matters:

- **No day structure at all.** `meals` has no day column — it is one flat
  list shown identically every day. `MemberNutritionScreen.jsx`'s `WeekStrip`
  picker is decorative; its own comment says so ("the selection deliberately
  drives nothing").
- **Writes are unhardened.** `saveNutritionPlan`/`saveMeal`/`deleteMeal`
  (`src/data/nutrition.js`) are plain `upsert`/`delete` calls straight
  against `nutrition_plans`/`meals` — this feature predates the whole
  `patches/015` security rewrite that moved every other write in the app
  behind a `*_secure` RPC.
- **No read/edit split for the professional.** `NutritionPlanEditorScreen.jsx`
  is always the edit form, even when viewing an already-complete plan.
- **Meals carry only kcal**, no per-meal macro breakdown, no alternatives —
  both explicitly wanted per `doc/nutrition_plan.md`'s reference structure.

This design brings Nutrition Plan to parity with the already-shipped
Workout Plan wizard (`docs/superpowers/specs/2026-09-02-workout-creation-
redesign-design.md` and its follow-ups): atomic secure creation, a
draft-then-commit wizard, replace-only editing, and a real read/replace
split for the professional. One deliberate divergence, decided with Davide:
**creation stays professional-only** — `doc/nutrition_plan.md` is explicit
that the client only ever views a nutrition plan, never authors one, unlike
Workout Plan's dual-role model.

Visual design (`/impeccable`) is explicitly a separate, later pass over the
finished functional screens — not part of this spec, matching how the
Workout Plan wizard's own graphics were sequenced.

## 1. Schema: Day Types

A new table, `nutrition_days` — the "Giorni Tipo" from
`doc/nutrition_plan.md`: named, reusable meal templates (Day A, Day B, ...)
that any combination of weekdays can point at, rather than one meal list
tied to no day at all.

```sql
alter table nutrition_plans
  add column if not exists replaces_plan_id uuid,
  add column if not exists notes text;
alter table nutrition_plans
  add constraint nutrition_plans_replaces_fk
  foreign key (replaces_plan_id) references nutrition_plans(id);

create table nutrition_days (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references nutrition_plans(id) on delete cascade,
  name     text not null,
  position int  not null,
  -- 0 = Sunday .. 6 = Saturday, matching JS `Date#getDay()` so the client
  -- needs no day-index translation. A weekday belongs to at most one day
  -- type -- enforced by construction in the wizard (one control per
  -- weekday, not per day type), not by a database constraint; see "Weekday
  -- assignment" below for why a DB-level uniqueness check isn't worth it
  -- here.
  weekdays smallint[] not null default '{}',
  unique (plan_id, position)
);

-- `meals` moves from the plan directly to owning it, to belonging to one of
-- its day types.
alter table meals rename column plan_id to day_id;
alter table meals
  drop constraint meals_plan_id_fkey,
  add constraint meals_day_id_fkey
    foreign key (day_id) references nutrition_days(id) on delete cascade;
alter table meals
  add column if not exists protein_g int,
  add column if not exists carbs_g int,
  add column if not exists fat_g int,
  add column if not exists alternatives text;
```

**Weekday assignment.** Storing `weekdays` as a plain array on
`nutrition_days`, rather than a separate junction table, is enough: the
wizard's own UI is weekday-centric (one selector per weekday choosing which
day type it belongs to), so a weekday can only ever be assigned once by
construction — there is no second UI path that could produce an overlap for
a database constraint to guard against. This mirrors the workout wizard's
own reasoning for keeping `position` a plain client-computed integer rather
than a second source of truth.

**Existing demo data.** The shape change (`meals.plan_id` → `meals.day_id`)
is not a compatible migration for existing rows — `seed.sql`'s nutrition
fixtures need rewriting to the new shape as part of this work, and any
nutrition plan already created on the shared demo database predates the
column rename and will need to be recreated afterward.

## 2. RPC: `create_nutrition_plan_secure`

One atomic call, mirroring `create_workout_plan_secure`
(`patches/015`, extended for multiple sessions in `patches/018`) exactly:
the plan, every day type, and every meal in each commit together, in the
same transaction a `plpgsql` function body already is.

```sql
create or replace function public.create_nutrition_plan_secure(
  p_plan_id uuid, p_member_id uuid, p_replaces_plan_id uuid,
  p_name text, p_kcal_target int, p_protein_g int, p_carbs_g int,
  p_fat_g int, p_notes text, p_days jsonb
) returns setof public.nutrition_plans
language plpgsql security definer set search_path = '' as $$
```

`p_days` is an array of `{id, name, position, weekdays, meals}`, each
`meals` entry shaped `{id, name, time_of_day, position, kcal, protein_g,
carbs_g, fat_g, alternatives, items}` (`items` unchanged: `[{food, qty}]`).

**Authorization is professional-only, not `owns_member`.** This is the one
deliberate divergence from `create_workout_plan_secure`
(`patches/017`'s widening): `doc/nutrition_plan.md` is explicit that a
client never authors their own nutrition plan, so the check stays exactly
what `create_workout_plan_secure` looked like before `patches/017` ever
touched it — `member.assigned_pro_id = auth.uid()`, no self-authorship
branch.

The replay/idempotency check and the `p_replaces_plan_id` optimistic-
concurrency check both carry over from the workout RPC unchanged in shape,
compared against `nutrition_plans` columns instead of `workout_plans`'.

Every direct `insert`/`update`/`delete` grant on `nutrition_plans`,
`nutrition_days`, and `meals` is revoked from `authenticated`, the same
`patches/015` treatment `workout_plans` already has — `saveNutritionPlan`,
`saveMeal`, and `deleteMeal` are deleted from `src/data/nutrition.js`
entirely, replaced by one `createNutritionPlan()` wrapper calling the RPC.

## 3. Flow: the same wizard shape as Workout Plan

Reuses the exact architecture already built for `CreatePlanFlow.jsx`/
`PlanSummary.jsx`: draft everything locally, write nothing until one
confirmed atomic call.

1. **Plan meta** — name, kcal target, three macros, notes. Same form shape
   as today's `PlanHeaderForm`, unchanged fields plus the new `notes` field.
2. **Day type loop** — name a day type, pick which weekdays it covers, add
   meals to it (name, time, kcal, three macros, alternatives, food items) —
   repeatable, exactly like the workout wizard's session loop.
3. **Summary** — review every drafted day type (edit/delete before commit,
   "Add another day type"), then **Confirm & create** (the one atomic RPC
   call) or **Abandon** (confirmation dialog, discards the draft, leaves any
   existing plan untouched) — available at every step, matching
   `CreatePlanFlow.jsx`'s existing `Cancel` button.

**Replace-only, no in-place edit, ever — for either role.** Once a plan
exists, the only way to change anything is to run the same wizard again
with `replacesPlanId` set. `doc/nutrition_plan.md` asks for this explicitly,
matching Workout Plan's own model; unlike Workout Plan there is no
`workout_runs`-style history this protects here, but the value is the same
consistent mental model across the app that Davide asked for, not a data-
integrity argument specific to nutrition.

## 4. Screens

- **`NutritionPlanEditorScreen.jsx`** (professional) becomes a three-state
  screen shaped exactly like `ClientWorkoutScreen.jsx`: no plan yet (the
  wizard), an existing plan (read-only — name, macros, notes, each day type
  and its meals, no edit controls at all) plus a single **Create
  replacement plan** button, or mid-replacement (the wizard again, with
  `replacesPlanId` set and the same "stays in history" `Alert` pattern
  `ClientWorkoutScreen.jsx` already uses).
- **`MemberNutritionScreen.jsx`**: `WeekStrip` becomes real. Selecting a day
  looks up which day type's `weekdays` array contains that day-of-week and
  renders its meals — the "no meals shown" empty state now means "no day
  type covers this weekday" rather than always being unreachable.
- **`MealDetailScreen.jsx`**: gains the three macro figures and the
  alternatives text alongside the existing food-item list.

## Out of scope

- Visual redesign (`/impeccable`) — a separate pass after this lands,
  scheduled the same way as the Workout Plan wizard's own graphics.
- Any client-side authoring of a nutrition plan — professional-only,
  confirmed with Davide, not a Workout-Plan-style dual-role model.
- Any in-place editing path, for either role, at any point after creation.
