# Nutrition Plan Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Nutrition Plan to parity with the Workout Plan wizard: Day
Types (weekday-assignable meal templates), atomic secure creation, replace-only
editing, per-meal macros and alternatives, and a real read/replace split for
the professional.

**Architecture:** `meals` moves from belonging directly to a plan to belonging
to a new `nutrition_days` row (name, `weekdays smallint[]`, position). One new
`security definer` RPC, `create_nutrition_plan_secure`, writes the plan, every
day type and every meal in one transaction -- mirroring
`create_workout_plan_secure` (`patches/015`/`018`) exactly, except
authorization stays professional-only (no `owns_member` self-authorship
branch: `doc/nutrition_plan.md` is explicit a client never authors their own
plan). The client wizard reuses `CreatePlanFlow.jsx`'s draft-then-commit shape
verbatim: nothing reaches the server until one confirmed atomic call.

**Tech Stack:** React 19, MUI v9, TanStack Query v5, Supabase (Postgres +
RLS), plain JS.

## Global Constraints

- **No in-place editing, ever, for either role.** The only way to change a
  nutrition plan after creation is to run the wizard again with
  `replacesPlanId` set. This applies to every screen and every RPC in this
  plan.
- **Professional-only creation.** `create_nutrition_plan_secure` checks
  `member.assigned_pro_id = auth.uid()` and `public.is_professional()` --
  never `public.owns_member()`. A client can view but never author a
  nutrition plan.
- **`weekdays` is `0 = Sunday .. 6 = Saturday`**, matching JS `Date#getDay()`,
  in every layer (DB column, RPC payload, client state) so nothing needs a
  day-index translation.
- **Dates: compute in the frame you mean.** `new Date('YYYY-MM-DD')` is UTC
  midnight and renders as the previous day west of Greenwich. The new
  `weekdayOf()` helper follows `mondayOf()`'s existing local-date-parsing
  pattern in `src/lib/week.js`.
- **A write whose signature changes needs its old overload dropped first.**
  `create or replace function` only replaces a function with the identical
  parameter list; a changed signature creates a second, parallel overload.
  Not expected to apply this patch (the RPC is new), but if any task changes
  `create_nutrition_plan_secure`'s signature mid-review, add
  `drop function if exists ...(old signature);` before the new
  `create or replace`.
- **Whitespace-stripped `LIKE` self-checks must themselves contain no
  spaces** -- the comparison pattern is matched against
  `regexp_replace(lower(pg_get_functiondef(...)), '[[:space:]]+', '', 'g')`.
- **No `eslint-disable`, ever.** If lint objects, the code is wrong.
- **Every Supabase read carries `.retry(navigator.onLine)`; writes must not.**
- **Every write is registered in `src/data/mutations.js`** via
  `setMutationDefaults`; call sites must never pass `onSettled` to
  `useMutation`.
- **`npm run lint` is not a sufficient check.** Always also run
  `npm run build` -- ESLint does not resolve module paths or MUI icon glyphs
  the installed `@mui/icons-material@9.2.0` does not ship.
- Run every `*.selfcheck.js` file after touching `src/lib/week.js` (see
  Task 10).

---

## File Structure

Create:
- `supabase/patches/022-nutrition-day-types.sql`
- `src/features/nutrition/contracts.js`
- `src/features/nutrition/DayForm.jsx`
- `src/features/nutrition/NutritionPlanForm.jsx`
- `src/features/nutrition/NutritionPlanSummary.jsx`
- `src/features/nutrition/CreateNutritionPlanFlow.jsx`

Modify:
- `src/lib/week.js`, `src/lib/week.selfcheck.js`
- `src/data/nutrition.js`
- `src/lib/mutationKeys.js`
- `src/data/mutations.js`
- `src/features/nutrition/NutritionPlanEditorScreen.jsx`
- `src/features/nutrition/MemberNutritionScreen.jsx`
- `src/features/nutrition/MealDetailScreen.jsx`
- `supabase/seed.sql`
- `supabase/verify.sql`
- `supabase/probe-rls.mjs`
- `CLAUDE.md`

No route changes: `src/routes/index.jsx` already points `/m/nutrition`,
`/m/nutrition/meal/:mealId` and `/p/clients/:clientId/nutrition` at the three
screens above, which are rewritten in place.

---

### Task 1: SQL patch 022 -- Day Types schema and `create_nutrition_plan_secure`

**Files:**
- Create: `supabase/patches/022-nutrition-day-types.sql`

**Interfaces:**
- Produces: table `public.nutrition_days (id, plan_id, name, position,
  weekdays smallint[])`; `public.meals.day_id` (renamed from `plan_id`) plus
  new columns `protein_g int, carbs_g int, fat_g int, alternatives text`;
  `public.nutrition_plans.replaces_plan_id uuid, notes text`; RPC
  `public.create_nutrition_plan_secure(p_plan_id uuid, p_member_id uuid,
  p_replaces_plan_id uuid, p_name text, p_kcal_target int, p_protein_g int,
  p_carbs_g int, p_fat_g int, p_notes text, p_days jsonb) returns setof
  public.nutrition_plans`. `p_days` shape: `[{id, name, position, weekdays:
  [int], meals: [{id, name, time_of_day, position, kcal, protein_g, carbs_g,
  fat_g, alternatives, items: [{food, qty}]}]}]`.

- [ ] **Step 1: Write the patch file**

```sql
-- Patch 022 -- Nutrition Plan: Day Types, secure creation, macros and
-- alternatives.
--
-- Brings Nutrition Plan to parity with the Workout Plan wizard
-- (patches/015, 017, 018): a plan is built as one atomic call (a
-- client-generated id, every day type, and every meal together), never
-- edited in place, only replaced. Unlike Workout Plan, creation stays
-- professional-only -- doc/nutrition_plan.md is explicit that a client
-- never authors their own nutrition plan, so the authorization check below
-- is what create_workout_plan_secure looked like before patches/017 ever
-- widened it: member.assigned_pro_id = auth.uid(), no self-authorship
-- branch.
--
-- `meals` moves from belonging directly to a plan to belonging to one of
-- its new nutrition_days rows. Existing demo nutrition data does not
-- survive the plan_id -> day_id rename -- seed.sql is rewritten in a
-- companion change, and any nutrition plan already created on the shared
-- demo database must be recreated afterward.
--
-- Idempotent: safe to replay.

begin;

alter table public.nutrition_plans
  add column if not exists replaces_plan_id uuid,
  add column if not exists notes text;

do $$ begin
  alter table public.nutrition_plans
    add constraint nutrition_plans_replaces_fk
    foreign key (replaces_plan_id) references public.nutrition_plans(id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

create unique index if not exists nutrition_plans_replaced_once_idx
  on public.nutrition_plans (replaces_plan_id)
  where replaces_plan_id is not null;

create table if not exists public.nutrition_days (
  id       uuid primary key default gen_random_uuid(),
  plan_id  uuid not null references public.nutrition_plans(id) on delete cascade,
  name     text not null,
  position int  not null,
  -- 0 = Sunday .. 6 = Saturday, matching JS `Date#getDay()` so the client
  -- needs no day-index translation. A weekday belongs to at most one day
  -- type -- enforced by construction in the wizard (one control per
  -- weekday, not per day type), not by a database constraint: there is no
  -- second UI path that could produce an overlap for a constraint to guard
  -- against, mirroring how `position` stays a plain client-computed
  -- integer elsewhere in this codebase.
  weekdays smallint[] not null default '{}',
  unique (plan_id, position)
);

alter table public.nutrition_days enable row level security;

drop policy if exists nutrition_days_select on public.nutrition_days;
create policy nutrition_days_select on public.nutrition_days
  for select using (
    exists (select 1 from public.nutrition_plans plan
            where plan.id = plan_id and public.owns_member(plan.member_id))
  );

-- `meals` moves from the plan directly to belonging to one of its day types.
do $$ begin
  alter table public.meals rename column plan_id to day_id;
exception when undefined_column then null;
end $$;

do $$ begin
  alter table public.meals drop constraint meals_plan_id_fkey;
exception when undefined_object then null;
end $$;

do $$ begin
  alter table public.meals
    add constraint meals_day_id_fkey
    foreign key (day_id) references public.nutrition_days(id) on delete cascade;
exception when duplicate_object then null;
end $$;

alter table public.meals
  add column if not exists protein_g int,
  add column if not exists carbs_g int,
  add column if not exists fat_g int,
  add column if not exists alternatives text;

-- Atomic creation, mirroring create_workout_plan_secure exactly except for
-- the professional-only authorization check.
create or replace function public.create_nutrition_plan_secure(
  p_plan_id uuid, p_member_id uuid, p_replaces_plan_id uuid,
  p_name text, p_kcal_target int, p_protein_g int, p_carbs_g int,
  p_fat_g int, p_notes text, p_days jsonb
) returns setof public.nutrition_plans
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_current uuid;
  v_row public.nutrition_plans%rowtype;
  v_day jsonb;
  v_day_id uuid;
  v_meal jsonb;
begin
  perform 1 from public.profiles member
  where member.id = p_member_id and member.role = 'member'
    and member.assigned_pro_id = v_actor for update;
  if not found or not public.is_professional() then
    raise exception 'only the assigned professional may create this plan'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_days) <> 'array' or jsonb_array_length(p_days) = 0 then
    raise exception 'a plan needs at least one day type' using errcode = '22023';
  end if;

  select plan.* into v_row from public.nutrition_plans plan
  where plan.id = p_plan_id;
  if found then
    if v_row.member_id is distinct from p_member_id
       or v_row.author_id is distinct from v_actor
       or v_row.name is distinct from p_name
       or v_row.kcal_target is distinct from p_kcal_target
       or v_row.protein_g is distinct from p_protein_g
       or v_row.carbs_g is distinct from p_carbs_g
       or v_row.fat_g is distinct from p_fat_g
       or v_row.notes is distinct from nullif(p_notes, '')
       or v_row.replaces_plan_id is distinct from p_replaces_plan_id then
      raise exception 'plan id is already used by different content'
        using errcode = '23505';
    end if;
    return next v_row;
    return;
  end if;

  select plan.id into v_current from public.nutrition_plans plan
  where plan.member_id = p_member_id
  order by plan.created_at desc, plan.id desc limit 1;
  if v_current is distinct from p_replaces_plan_id then
    raise exception 'the member plan changed before this save arrived'
      using errcode = '40001';
  end if;

  insert into public.nutrition_plans (
    id, member_id, author_id, name, kcal_target, protein_g, carbs_g, fat_g,
    notes, replaces_plan_id
  ) values (
    p_plan_id, p_member_id, v_actor, p_name, p_kcal_target, p_protein_g,
    p_carbs_g, p_fat_g, nullif(p_notes, ''), p_replaces_plan_id
  ) returning * into v_row;

  for v_day in select * from jsonb_array_elements(p_days)
  loop
    if coalesce(jsonb_array_length(v_day->'weekdays'), 0) = 0 then
      raise exception 'a day type needs at least one weekday' using errcode = '22023';
    end if;
    if jsonb_typeof(v_day->'meals') <> 'array'
       or jsonb_array_length(v_day->'meals') = 0 then
      raise exception 'a day type needs at least one meal' using errcode = '22023';
    end if;

    v_day_id := (v_day->>'id')::uuid;

    insert into public.nutrition_days (id, plan_id, name, position, weekdays)
    values (
      v_day_id, p_plan_id, v_day->>'name', (v_day->>'position')::int,
      array(select jsonb_array_elements_text(v_day->'weekdays'))::smallint[]
    );

    for v_meal in select * from jsonb_array_elements(v_day->'meals')
    loop
      insert into public.meals (
        id, day_id, name, time_of_day, position, kcal, protein_g, carbs_g,
        fat_g, alternatives, items
      ) values (
        (v_meal->>'id')::uuid, v_day_id, v_meal->>'name',
        v_meal->>'time_of_day', (v_meal->>'position')::int,
        (v_meal->>'kcal')::int, (v_meal->>'protein_g')::int,
        (v_meal->>'carbs_g')::int, (v_meal->>'fat_g')::int,
        nullif(v_meal->>'alternatives', ''),
        coalesce(v_meal->'items', '[]'::jsonb)
      );
    end loop;
  end loop;

  return next v_row;
end;
$$;

revoke execute on function public.create_nutrition_plan_secure(
  uuid, uuid, uuid, text, int, int, int, int, text, jsonb
) from public, anon;
grant execute on function public.create_nutrition_plan_secure(
  uuid, uuid, uuid, text, int, int, int, int, text, jsonb
) to authenticated;

-- Direct writes carried caller-controlled member/author ids. Reads stay
-- under RLS; writes now go through the operation above.
revoke insert, update, delete on public.nutrition_plans, public.nutrition_days,
  public.meals from anon, authenticated;
drop policy if exists nutrition_plans_write_pro on public.nutrition_plans;
drop policy if exists meals_write_pro on public.meals;

drop table if exists pg_temp.patch_022_checks;
create temporary table patch_022_checks (
  check_name text not null,
  actual text,
  expected text not null
) on commit preserve rows;

insert into patch_022_checks (check_name, actual, expected) values
  ('nutrition_days table exists',
   (to_regclass('public.nutrition_days') is not null)::text, 'true'),
  ('nutrition_days has RLS enabled',
   (select rowsecurity::text from pg_tables
    where schemaname = 'public' and tablename = 'nutrition_days'), 'true'),
  ('meals day_id column exists',
   (select (count(*) = 1)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'meals'
      and column_name = 'day_id'), 'true'),
  ('meals plan_id column is gone',
   (select (count(*) = 0)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'meals'
      and column_name = 'plan_id'), 'true'),
  ('meals macro columns exist',
   (select (count(*) = 3)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'meals'
      and column_name in ('protein_g', 'carbs_g', 'fat_g')), 'true'),
  ('meals alternatives column exists',
   (select (count(*) = 1)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'meals'
      and column_name = 'alternatives'), 'true'),
  ('nutrition_plans predecessor column exists',
   (select (count(*) = 1)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'nutrition_plans'
      and column_name = 'replaces_plan_id'), 'true'),
  ('nutrition_plans notes column exists',
   (select (count(*) = 1)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'nutrition_plans'
      and column_name = 'notes'), 'true'),
  ('nutrition plan predecessor is replaced at most once',
   (select (count(*) = 1)::text from pg_indexes
    where schemaname = 'public' and tablename = 'nutrition_plans'
      and indexname = 'nutrition_plans_replaced_once_idx'
      and indexdef ilike '%unique%'), 'true'),
  ('create_nutrition_plan_secure exists',
   (to_regprocedure(
     'public.create_nutrition_plan_secure(uuid,uuid,uuid,text,int,int,int,int,text,jsonb)'
   ) is not null)::text, 'true'),
  ('create_nutrition_plan_secure is hardened',
   (select (count(*) = 1)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_nutrition_plan_secure'
      and p.prosecdef and coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false)),
   'true'),
  ('creation is professional-only, not owns_member',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%member.assigned_pro_id=v_actor%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_nutrition_plan_secure'),
   'true'),
  ('plan creation loops over multiple days',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%jsonb_array_elements(p_days)%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_nutrition_plan_secure'),
   'true'),
  ('authenticated caller can create a nutrition plan',
   has_function_privilege(
     'authenticated',
     'public.create_nutrition_plan_secure(uuid,uuid,uuid,text,int,int,int,int,text,jsonb)',
     'execute')::text, 'true'),
  ('anonymous caller cannot create a nutrition plan',
   has_function_privilege(
     'anon',
     'public.create_nutrition_plan_secure(uuid,uuid,uuid,text,int,int,int,int,text,jsonb)',
     'execute')::text, 'false'),
  ('app cannot directly insert nutrition plans',
   has_table_privilege('authenticated', 'public.nutrition_plans', 'insert')::text, 'false'),
  ('app cannot directly insert nutrition days',
   has_table_privilege('authenticated', 'public.nutrition_days', 'insert')::text, 'false'),
  ('app cannot directly insert meals',
   has_table_privilege('authenticated', 'public.meals', 'insert')::text, 'false'),
  ('app can read nutrition days',
   has_table_privilege('authenticated', 'public.nutrition_days', 'select')::text, 'true'),
  ('legacy nutrition write policies removed',
   (select (count(*) = 0)::text from pg_policies
    where schemaname = 'public'
      and policyname in ('nutrition_plans_write_pro', 'meals_write_pro')),
   'true');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_022_checks
order by check_name;
```

- [ ] **Step 2: Hand off to Davide for manual application**

This patch is applied by hand in the Supabase SQL editor (no agent has
credentials). Report the file path and ask Davide to run it, then paste back
whether every row reads PASS. Do not proceed to Task 3 (which depends on the
new schema) until confirmed -- Tasks 2, 4, 5 do not touch the database and
may proceed in the meantime.

- [ ] **Step 3: Commit**

```bash
git add supabase/patches/022-nutrition-day-types.sql
git commit -m "feat: add nutrition Day Types schema and create_nutrition_plan_secure"
```

---

### Task 2: `weekdayOf()` helper

**Files:**
- Modify: `src/lib/week.js`
- Modify: `src/lib/week.selfcheck.js`

**Interfaces:**
- Produces: `weekdayOf(dayISO: string): number` (0 = Sunday .. 6 = Saturday).

- [ ] **Step 1: Add `weekdayOf` to `src/lib/week.js`**

Insert after `mondayOf` (which already ends at line 34):

```js
/**
 * `Date#getDay()` (0 = Sunday .. 6 = Saturday) for `dayISO`, read in the
 * local calendar -- the frame `nutrition_days.weekdays` is stored in, so
 * the client needs no day-index translation.
 *
 * Built from local date parts, like `mondayOf` above: `new Date('YYYY-MM-DD')`
 * is UTC midnight and lands on the previous day west of Greenwich.
 */
export function weekdayOf(dayISO) {
  const [year, month, day] = String(dayISO).slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day).getDay()
}
```

- [ ] **Step 2: Extend the selfcheck**

In `src/lib/week.selfcheck.js`, change the import on line 3 to:

```js
import { daysBefore, earnedOn, mondayOf, runStatusOf, weekdayOf } from './week.js'
```

Add this block after the `mondayOf` section (after line 18, before `--- daysBefore ---`):

```js

// --- weekdayOf --------------------------------------------------------------
// 2026-08-05 is a Wednesday.
assert.equal(weekdayOf('2026-08-05'), 3)
// Sunday is 0, not remapped to 7 -- unlike mondayOf's internal remap, this is
// the raw getDay() value because nutrition_days.weekdays is stored in that
// frame.
assert.equal(weekdayOf('2026-08-09'), 0)
// Monday is 1.
assert.equal(weekdayOf('2026-08-03'), 1)
// A full ISO instant is accepted too, so callers need not slice it themselves.
assert.equal(weekdayOf('2026-08-05T22:30:00+02:00'), 3)
```

- [ ] **Step 3: Run the selfcheck**

Run: `node src/lib/week.selfcheck.js`
Expected: `workout week: OK`

- [ ] **Step 4: Commit**

```bash
git add src/lib/week.js src/lib/week.selfcheck.js
git commit -m "feat: add weekdayOf helper for nutrition day-type lookup"
```

---

### Task 3: `contracts.js`, `src/data/nutrition.js` rewrite, mutation/query key wiring

**Depends on:** Task 1 applied to the database.

**Files:**
- Create: `src/features/nutrition/contracts.js`
- Modify: `src/data/nutrition.js` (full rewrite)
- Modify: `src/lib/mutationKeys.js`
- Modify: `src/data/mutations.js`

**Interfaces:**
- Consumes: `createUuid()` from `src/lib/uuid.js`.
- Produces: `buildMealItemPayloads(items)`, `buildMealPayloads(meals,
  createId?)`, `buildDayPayloads(days, createId?)` from `contracts.js`;
  `fetchNutritionPlan(memberId): Promise<{plan, days} | null>` and
  `createNutritionPlan({id, memberId, replacesPlanId, name, kcalTarget,
  proteinG, carbsG, fatG, notes, days}): Promise<object>` from
  `src/data/nutrition.js`; `mutationKeys.createNutritionPlan`.

- [ ] **Step 1: Write `src/features/nutrition/contracts.js`**

```js
import { createUuid } from '../../lib/uuid.js'

/**
 * Freeze a meal's food items into the JSON contract
 * `create_nutrition_plan_secure` (patches/022) consumes.
 *
 * No id is needed here: unlike meals and days, items have no table row of
 * their own -- they live inside `meals.items jsonb`. Rows the user added and
 * left blank are dropped rather than written as empty objects.
 */
export function buildMealItemPayloads(items) {
  return (items ?? [])
    .filter((item) => item.food?.trim())
    .map((item) => ({ food: item.food.trim(), qty: item.qty || '' }))
}

/**
 * Freeze a day type's meals into the JSON contract the RPC consumes. IDs are
 * created before the mutation is queued, so an offline replay sends the
 * exact same meal rows instead of inventing new ones on every attempt.
 */
export function buildMealPayloads(meals, createId = createUuid) {
  return (meals ?? []).map((meal, index) => ({
    id: meal.id ?? createId(),
    name: meal.name,
    time_of_day: meal.timeOfDay,
    position: index + 1,
    kcal: meal.kcal,
    protein_g: meal.proteinG,
    carbs_g: meal.carbsG,
    fat_g: meal.fatG,
    alternatives: meal.alternatives || null,
    items: buildMealItemPayloads(meal.items),
  }))
}

/**
 * Freeze every drafted day type into the JSON contract
 * `create_nutrition_plan_secure` consumes: an ordered array of day bundles,
 * each carrying its own meals built the same way `buildMealPayloads`
 * already builds them.
 */
export function buildDayPayloads(days, createId = createUuid) {
  return (days ?? []).map((day, index) => ({
    id: day.id ?? createId(),
    name: day.name,
    position: index + 1,
    weekdays: day.weekdays ?? [],
    meals: buildMealPayloads(day.meals, createId),
  }))
}
```

- [ ] **Step 2: Rewrite `src/data/nutrition.js`**

Replace the entire file:

```js
import { supabase } from '../lib/supabase.js'

const MEAL_COLUMNS =
  'id, name, time_of_day, position, kcal, protein_g, carbs_g, fat_g, alternatives, items'
const DAY_COLUMNS = `id, name, position, weekdays, meals ( ${MEAL_COLUMNS} )`

/**
 * The member's current nutrition plan, its day types, and their meals.
 *
 * "Current" is the most recently created plan, matching `fetchActivePlan`'s
 * rule for workouts. Returns null rather than throwing when there is none.
 */
export async function fetchNutritionPlan(memberId) {
  const { data: plan, error: planError } = await supabase
    .from('nutrition_plans')
    .select('id, name, kcal_target, protein_g, carbs_g, fat_g, notes, created_at, replaces_plan_id')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .retry(navigator.onLine)

  if (planError) throw planError
  if (!plan) return null

  const { data: days, error: daysError } = await supabase
    .from('nutrition_days')
    .select(DAY_COLUMNS)
    .eq('plan_id', plan.id)
    .order('position')
    .retry(navigator.onLine)

  if (daysError) throw daysError

  return {
    plan,
    days: (days ?? []).map((day) => ({
      ...day,
      // PostgREST does not order rows embedded through a foreign table.
      meals: [...(day.meals ?? [])].sort((a, b) => a.position - b.position),
    })),
  }
}

/**
 * Create a nutrition plan for a client -- meta, every day type, and every
 * meal -- in one atomic call. Only the client's assigned professional may
 * call this: unlike workout plans, a client never authors their own
 * nutrition plan (doc/nutrition_plan.md).
 */
export async function createNutritionPlan({
  id, memberId, replacesPlanId, name, kcalTarget, proteinG, carbsG, fatG, notes, days,
}) {
  const { data, error } = await supabase
    .rpc('create_nutrition_plan_secure', {
      p_plan_id: id,
      p_member_id: memberId,
      p_replaces_plan_id: replacesPlanId ?? null,
      p_name: name,
      p_kcal_target: kcalTarget,
      p_protein_g: proteinG,
      p_carbs_g: carbsG,
      p_fat_g: fatG,
      p_notes: notes || null,
      p_days: days,
    })
    .single()

  if (error) throw error
  return data
}
```

- [ ] **Step 3: Update `src/lib/mutationKeys.js`**

Replace lines 14-16 (`saveNutritionPlan`, `saveMeal`, `deleteMeal`) with:

```js
  createNutritionPlan: ['createNutritionPlan'],
```

- [ ] **Step 4: Update `src/data/mutations.js`**

Change the import on line 3 from:

```js
import { deleteMeal, saveMeal, saveNutritionPlan } from './nutrition.js'
```

to:

```js
import { createNutritionPlan } from './nutrition.js'
```

Replace the three registrations at lines 197-225 (the `saveNutritionPlan`,
`saveMeal` and `deleteMeal` blocks, including their comments) with one:

```js
  // No scope needed: the whole plan -- meta, every day, every meal -- is
  // one atomic write, so there is no multi-step ordering left to protect
  // (matching how the workout wizard's createPlan needs none either).
  queryClient.setMutationDefaults(mutationKeys.createNutritionPlan, {
    mutationFn: createNutritionPlan,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.nutritionPlan })
    },
  })
```

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: no errors (no other file references `saveNutritionPlan`, `saveMeal`
or `deleteMeal` yet -- those call sites are rewritten in Tasks 4-6, which
must land before `npm run build` can pass end-to-end; that full check happens
in Task 10).

- [ ] **Step 6: Commit**

```bash
git add src/features/nutrition/contracts.js src/data/nutrition.js \
  src/lib/mutationKeys.js src/data/mutations.js
git commit -m "feat: rewrite nutrition data layer around create_nutrition_plan_secure"
```

---

### Task 4: `DayForm.jsx`

**Files:**
- Create: `src/features/nutrition/DayForm.jsx`

**Interfaces:**
- Produces: `<DayForm onSubmit={({name, weekdays, meals}) => void}
  initial={?{name, weekdays, meals}} submitLabel={?string} />`. `meals` is
  shaped `{name, timeOfDay, kcal, proteinG, carbsG, fatG, alternatives,
  items: [{food, qty}]}[]` -- the shape `buildMealPayloads` (Task 3) expects.

- [ ] **Step 1: Write the component**

```jsx
import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { EmptyState } from '../../components/ScreenState.jsx'

// 0 = Sunday .. 6 = Saturday, matching `nutrition_days.weekdays` and
// `Date#getDay()`. Displayed Monday-first for readability; the stored value
// is unaffected by display order.
const WEEKDAYS = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
]

/** A number field that keeps '' distinct from 0 while editing. */
function NumberField({ label, value, onChange, width }) {
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', min: 0 } }}
      sx={{ width }}
    />
  )
}

// '' must not become 0: an empty macro field means "not set".
const toNumberOrNull = (value) => (value === '' || value === null ? null : Number(value))

/** One meal being drafted inside this day: its fields plus its food items. */
function MealBuilder({ onAdd }) {
  const [name, setName] = useState('')
  const [time, setTime] = useState('12:00')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [alternatives, setAlternatives] = useState('')
  const [items, setItems] = useState([])

  const updateItem = (index, field, value) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, [field]: value } : item)))

  const reset = () => {
    setName('')
    setTime('12:00')
    setKcal('')
    setProtein('')
    setCarbs('')
    setFat('')
    setAlternatives('')
    setItems([])
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h3">Add a meal</Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'minmax(0, 1fr) 130px 100px' },
              gap: 1,
            }}
          >
            <TextField
              label="Meal"
              value={name}
              onChange={(event) => setName(event.target.value)}
              sx={{ gridColumn: { xs: '1 / 3', sm: 'auto' } }}
            />
            {/* Native time input: the platform already renders a correct,
                accessible, locale-aware picker on every target device. */}
            <TextField
              label="Time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <NumberField label="kcal" value={kcal} onChange={setKcal} width="100%" />
          </Box>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <NumberField label="Protein g" value={protein} onChange={setProtein} width={100} />
            <NumberField label="Carbs g" value={carbs} onChange={setCarbs} width={100} />
            <NumberField label="Fat g" value={fat} onChange={setFat} width={100} />
          </Stack>

          <TextField
            label="Alternatives"
            value={alternatives}
            onChange={(event) => setAlternatives(event.target.value)}
            placeholder="200g egg whites, 4 crispbreads..."
            multiline
            minRows={2}
            fullWidth
          />

          <Divider />

          {items.map((item, index) => (
            <Box
              key={index}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: 'minmax(0, 1fr) 120px auto' },
                gap: 1,
                alignItems: 'center',
              }}
            >
              <TextField
                label="Food"
                value={item.food ?? ''}
                onChange={(event) => updateItem(index, 'food', event.target.value)}
                sx={{ minWidth: 0 }}
              />
              <TextField
                label="Quantity"
                value={item.qty ?? ''}
                onChange={(event) => updateItem(index, 'qty', event.target.value)}
                placeholder="80 g"
                sx={{ width: '100%', gridColumn: { xs: '1 / 3', sm: 'auto' } }}
              />
              <IconButton
                aria-label={`Remove ${item.food || 'item'}`}
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                sx={{ gridColumn: { xs: '2', sm: 'auto' }, gridRow: { xs: '1', sm: 'auto' } }}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Box>
          ))}

          <Button
            startIcon={<AddIcon />}
            onClick={() => setItems((current) => [...current, { food: '', qty: '' }])}
          >
            Add item
          </Button>

          <Button
            variant="outlined"
            disabled={!name.trim()}
            onClick={() => {
              onAdd({
                name,
                timeOfDay: time,
                kcal: toNumberOrNull(kcal),
                proteinG: toNumberOrNull(protein),
                carbsG: toNumberOrNull(carbs),
                fatG: toNumberOrNull(fat),
                alternatives,
                items,
              })
              reset()
            }}
          >
            Add meal to this day
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

/**
 * Build one day type: a name, which weekdays it covers, and its meals.
 *
 * Meals are drafted locally through `MealBuilder` and only ever appended
 * here -- like `SessionForm.jsx`'s exercises, nothing is written until the
 * whole plan is submitted as part of `CreateNutritionPlanFlow`'s one atomic
 * create.
 *
 * @param {object}   props
 * @param {Function} props.onSubmit    `({name, weekdays, meals}) => void`
 * @param {?object}  props.initial     `{name, weekdays, meals}` to reopen with.
 * @param {string}   props.submitLabel Idle label for the button.
 */
export default function DayForm({ onSubmit, initial = null, submitLabel = 'Save day' }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [weekdays, setWeekdays] = useState(() => new Set(initial?.weekdays ?? []))
  const [meals, setMeals] = useState(initial?.meals ?? [])

  const toggleWeekday = (value) => {
    setWeekdays((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit({ name, weekdays: [...weekdays], meals })
  }

  return (
    <Stack component="form" onSubmit={handleSubmit} spacing={3}>
      <TextField
        label="Day name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Day A"
        required
        fullWidth
      />

      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Which days of the week is this?
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {WEEKDAYS.map(({ value, label }) => (
            <Chip
              key={value}
              label={label}
              color={weekdays.has(value) ? 'primary' : 'default'}
              onClick={() => toggleWeekday(value)}
              aria-pressed={weekdays.has(value)}
            />
          ))}
        </Stack>
      </Box>

      <Divider />

      {meals.length === 0 ? (
        <EmptyState title="No meals yet" description="Add the first meal below." />
      ) : (
        <Stack spacing={2}>
          {meals.map((meal, index) => (
            <Card key={index}>
              <CardContent>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>{meal.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {meal.timeOfDay}
                      {meal.kcal == null ? '' : ` • ${meal.kcal} kcal`}
                    </Typography>
                  </Box>
                  <IconButton
                    aria-label={`Remove ${meal.name}`}
                    onClick={() => setMeals((current) => current.filter((_, i) => i !== index))}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <MealBuilder onAdd={(meal) => setMeals((current) => [...current, meal])} />

      {meals.length === 0 ? (
        <Alert severity="warning">A day needs at least one meal before it can be saved.</Alert>
      ) : null}

      <Button type="submit" variant="contained" size="large" fullWidth disabled={meals.length === 0}>
        {submitLabel}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/nutrition/DayForm.jsx
git commit -m "feat: add DayForm for drafting nutrition day types"
```

---

### Task 5: `NutritionPlanForm.jsx`, `NutritionPlanSummary.jsx`, `CreateNutritionPlanFlow.jsx`

**Depends on:** Task 3 (`mutationKeys.createNutritionPlan`, `contracts.js`),
Task 4 (`DayForm.jsx`).

**Files:**
- Create: `src/features/nutrition/NutritionPlanForm.jsx`
- Create: `src/features/nutrition/NutritionPlanSummary.jsx`
- Create: `src/features/nutrition/CreateNutritionPlanFlow.jsx`

**Interfaces:**
- Consumes: `mutationKeys.createNutritionPlan` (Task 3),
  `buildDayPayloads` (Task 3), `createUuid` (`src/lib/uuid.js`), `DayForm`
  (Task 4).
- Produces: `<CreateNutritionPlanFlow memberId replacesPlanId={?string}
  onDone onAbandon />`, the screen-facing component Tasks 6 and 7 render.

- [ ] **Step 1: Write `NutritionPlanForm.jsx`**

```jsx
import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'

/** A number field that keeps '' distinct from 0 while editing. */
function NumberField({ label, value, onChange }) {
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', min: 0 } }}
      fullWidth
    />
  )
}

// '' must not become 0: an empty macro field means "not set", and the
// column is nullable precisely so it can say so.
const toNumberOrNull = (value) => (value === '' || value === null ? null : Number(value))

/**
 * A nutrition plan's metadata: name, calorie target, three macros, notes.
 *
 * Mirrors `PlanForm.jsx`'s role for Workout Plan: owns only its draft, does
 * not write anything itself.
 *
 * @param {object}   props
 * @param {Function} props.onSubmit    `({name, kcalTarget, proteinG, carbsG, fatG, notes}) => void`
 * @param {?object}  props.initial     Values to reopen with, after Back.
 * @param {string}   props.submitLabel Label for the button.
 */
export default function NutritionPlanForm({ onSubmit, initial = null, submitLabel = 'Continue' }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kcal, setKcal] = useState(initial?.kcalTarget ?? '')
  const [protein, setProtein] = useState(initial?.proteinG ?? '')
  const [carbs, setCarbs] = useState(initial?.carbsG ?? '')
  const [fat, setFat] = useState(initial?.fatG ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  return (
    <Stack
      component="form"
      spacing={3}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          name,
          kcalTarget: toNumberOrNull(kcal),
          proteinG: toNumberOrNull(protein),
          carbsG: toNumberOrNull(carbs),
          fatG: toNumberOrNull(fat),
          notes,
        })
      }}
    >
      <TextField
        label="Plan name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Lean Bulk"
        required
        fullWidth
      />
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <NumberField label="kcal target" value={kcal} onChange={setKcal} />
        <NumberField label="Protein g" value={protein} onChange={setProtein} />
        <NumberField label="Carbs g" value={carbs} onChange={setCarbs} />
        <NumberField label="Fat g" value={fat} onChange={setFat} />
      </Stack>
      <TextField
        label="Additional notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Hydration, supplements, condiments..."
        multiline
        minRows={2}
        fullWidth
      />

      <Button type="submit" variant="contained" size="large" fullWidth>
        {submitLabel}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 2: Write `NutritionPlanSummary.jsx`**

```jsx
import {
  Alert, Box, Button, Card, CardContent, IconButton, Stack, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'

const WEEKDAY_INITIALS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Review the plan drafted so far, before anything is written.
 *
 * Every action here is local until `onConfirm` fires the one atomic write --
 * editing plan details, editing or deleting a drafted day never touches the
 * server.
 *
 * @param {object}   props
 * @param {object}   props.meta        `{name, kcalTarget, proteinG, carbsG, fatG, notes}`.
 * @param {Array}    props.days        `{id, name, weekdays, meals}[]`, drafted so far.
 * @param {boolean}  props.pending     The create/replace write is in flight.
 * @param {boolean}  props.paused      The write is parked offline.
 * @param {?Error}   props.error       The last failure, if any.
 * @param {Function} props.onEditMeta  Go back and edit the plan's own details.
 * @param {Function} props.onAddDay    Start drafting another day type.
 * @param {Function} props.onEditDay   `(index) => void`, reopen a drafted day.
 * @param {Function} props.onDeleteDay `(index) => void`, drop a drafted day.
 * @param {Function} props.onConfirm   Fire the one atomic write.
 */
export default function NutritionPlanSummary({
  meta, days, pending, paused, error, onEditMeta, onAddDay, onEditDay, onDeleteDay, onConfirm,
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h2">Review your plan</Typography>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h3" noWrap>{meta.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {meta.kcalTarget ?? '—'} kcal
              </Typography>
            </Box>
            <Button size="small" onClick={onEditMeta} disabled={pending}>
              Edit details
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={2}>
        {days.map((day, index) => (
          <Card key={day.id}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>{day.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {day.weekdays.length === 0
                      ? 'No days assigned'
                      : day.weekdays
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => WEEKDAY_INITIALS[d])
                        .join(', ')}
                    {' • '}{day.meals.length} meals
                  </Typography>
                </Box>
                <Button size="small" onClick={() => onEditDay(index)} disabled={pending}>
                  Edit
                </Button>
                <IconButton
                  aria-label={`Remove ${day.name}`}
                  disabled={pending}
                  onClick={() => {
                    // `confirm` rather than a dialog component: one
                    // destructive action on one screen, already accessible
                    // and blocking.
                    if (window.confirm(`Remove "${day.name}" from this plan?`)) {
                      onDeleteDay(index)
                    }
                  }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Button variant="outlined" size="large" fullWidth onClick={onAddDay} disabled={pending}>
        Add another day
      </Button>

      {/* Offline the mutation pauses: onSuccess never runs, no error is
          raised, and the button would sit on "Creating…" forever with
          nothing to explain it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. This plan is saved on your device and will be created when you
          reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">{error.message ?? 'The plan could not be created. Try again.'}</Alert>
      ) : null}

      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={days.length === 0 || pending}
        onClick={onConfirm}
      >
        {paused ? 'Saved offline' : pending ? 'Creating…' : 'Confirm & create plan'}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 3: Write `CreateNutritionPlanFlow.jsx`**

```jsx
import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import NutritionPlanForm from './NutritionPlanForm.jsx'
import DayForm from './DayForm.jsx'
import NutritionPlanSummary from './NutritionPlanSummary.jsx'
import { buildDayPayloads } from './contracts.js'

/**
 * Build a nutrition plan as a local draft -- meta, then any number of day
 * types -- and write the whole thing in one atomic call when the
 * professional confirms. Nothing reaches the server before that.
 *
 * Professional-only: unlike `CreatePlanFlow.jsx` (Workout Plan), there is no
 * member-authored path here -- `doc/nutrition_plan.md` is explicit that a
 * client only ever views a nutrition plan.
 *
 * @param {object}   props
 * @param {string}   props.memberId       Who the plan is for.
 * @param {?string}  props.replacesPlanId The plan this one supersedes, if any.
 * @param {Function} props.onDone         The atomic write succeeded.
 * @param {Function} props.onAbandon      The user confirmed discarding the draft.
 */
export default function CreateNutritionPlanFlow({ memberId, replacesPlanId = null, onDone, onAbandon }) {
  const [step, setStep] = useState('meta') // 'meta' | 'day' | 'summary'
  const [meta, setMeta] = useState(null)
  const [days, setDays] = useState([])
  const [editingIndex, setEditingIndex] = useState(null)

  const createPlan = useMutation({ mutationKey: mutationKeys.createNutritionPlan })

  const confirmAbandon = () => {
    if (window.confirm('Discard this plan? Nothing entered so far will be saved.')) {
      onAbandon()
    }
  }

  let body

  if (step === 'meta') {
    body = (
      <NutritionPlanForm
        // Set once the summary exists, so returning here to fix a typo
        // reopens filled in rather than blank.
        initial={meta}
        onSubmit={(values) => {
          setMeta(values)
          // First pass through has no days yet, so it continues into
          // drafting one; reopened later from the summary (which already
          // has days), it returns there instead of restarting the flow.
          setStep(days.length > 0 ? 'summary' : 'day')
        }}
      />
    )
  } else if (step === 'day') {
    // Reopening a drafted day from the summary pre-fills the form; adding a
    // new one starts blank.
    const editing = editingIndex !== null ? days[editingIndex] : null
    body = (
      <Stack spacing={2}>
        <DayForm
          submitLabel={editing ? 'Save changes' : 'Add day'}
          initial={editing}
          onSubmit={({ name, weekdays, meals }) => {
            const drafted = { id: editing?.id ?? createUuid(), name, weekdays, meals }
            setDays((current) =>
              editingIndex === null
                ? [...current, drafted]
                : current.map((day, index) => (index === editingIndex ? drafted : day)),
            )
            setEditingIndex(null)
            setStep('summary')
          }}
        />
        {/* Only once there is a summary worth returning to -- drafting the
            very first day has nowhere to go back to yet, and Cancel already
            covers leaving the flow entirely. */}
        {days.length > 0 ? (
          <Button
            onClick={() => {
              setEditingIndex(null)
              setStep('summary')
            }}
          >
            Back to summary
          </Button>
        ) : null}
      </Stack>
    )
  } else {
    // step === 'summary'
    body = (
      <NutritionPlanSummary
        meta={meta}
        days={days}
        pending={createPlan.isPending}
        paused={createPlan.isPending && createPlan.isPaused}
        error={createPlan.error}
        onEditMeta={() => setStep('meta')}
        onAddDay={() => {
          setEditingIndex(null)
          setStep('day')
        }}
        onEditDay={(index) => {
          setEditingIndex(index)
          setStep('day')
        }}
        onDeleteDay={(index) => setDays((current) => current.filter((_, i) => i !== index))}
        onConfirm={() => {
          // Generated here, in the handler: `react-hooks/purity` forbids
          // `crypto.randomUUID()` in a render body. It is also the
          // idempotency key the secure operation checks, so a replay
          // returns the same bundle rather than creating a second plan
          // that hides the first.
          createPlan.mutate(
            {
              id: createUuid(),
              memberId,
              replacesPlanId,
              ...meta,
              days: buildDayPayloads(days),
            },
            { onSuccess: onDone },
          )
        }}
      />
    )
  }

  return (
    <Stack spacing={2}>
      {body}
      <Button onClick={confirmAbandon} disabled={createPlan.isPending} fullWidth>
        Cancel
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/nutrition/NutritionPlanForm.jsx \
  src/features/nutrition/NutritionPlanSummary.jsx \
  src/features/nutrition/CreateNutritionPlanFlow.jsx
git commit -m "feat: add the nutrition plan creation wizard"
```

---

### Task 6: `NutritionPlanEditorScreen.jsx` rewrite (professional)

**Depends on:** Task 3 (`fetchNutritionPlan`'s new `{plan, days}` shape),
Task 5 (`CreateNutritionPlanFlow`).

**Files:**
- Modify: `src/features/nutrition/NutritionPlanEditorScreen.jsx` (full rewrite)

**Interfaces:**
- Consumes: `fetchNutritionPlan` (Task 3), `CreateNutritionPlanFlow` (Task 5),
  `fetchClient` (`src/data/clients.js`, unchanged), `PageHeader`
  (`src/components/PageHeader.jsx`, unchanged).

- [ ] **Step 1: Replace the entire file**

Three states, mirroring `ClientWorkoutScreen.jsx`'s shape exactly: no plan
yet (the wizard), an existing plan (read-only, no edit controls anywhere)
plus a single "Create replacement plan" button, or mid-replacement (the
wizard again, with `replacesPlanId` set).

```jsx
import { useState } from 'react'
import { Alert, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import CreateNutritionPlanFlow from './CreateNutritionPlanFlow.jsx'

const WEEKDAY_INITIALS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function NutritionPlanEditorScreen() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [replacing, setReplacing] = useState(false)

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(clientId),
    queryFn: () => fetchNutritionPlan(clientId),
  })

  if (nutrition.isPending || client.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const clientName = client.data?.full_name ?? 'this client'

  // No plan yet. The professional-only wizard: everything is drafted
  // locally and written in one atomic call, so abandoning leaves nothing
  // behind.
  if (nutrition.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <PageHeader
          title="Nutrition Plan"
          subtitle={clientName}
          backTo={`/p/clients/${clientId}`}
          backLabel="Back to client profile"
        />
        <Typography color="text.secondary">{clientName} has no nutrition plan yet.</Typography>
        <CreateNutritionPlanFlow
          memberId={clientId}
          onDone={() => nutrition.refetch()}
          onAbandon={() => navigate(`/p/clients/${clientId}`)}
        />
      </Stack>
    )
  }

  const { plan, days } = nutrition.data

  if (replacing) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <PageHeader
          title="Replace plan"
          subtitle={clientName}
          backTo={`/p/clients/${clientId}`}
          backLabel="Back to client profile"
        />
        <Alert severity="info">
          The current plan stays in the client history. The new one becomes active as soon as
          you confirm it below.
        </Alert>
        <CreateNutritionPlanFlow
          memberId={clientId}
          replacesPlanId={plan.id}
          onDone={() => {
            setReplacing(false)
            nutrition.refetch()
          }}
          onAbandon={() => setReplacing(false)}
        />
      </Stack>
    )
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title="Nutrition Plan"
        subtitle={clientName}
        backTo={`/p/clients/${clientId}`}
        backLabel="Back to client profile"
      />

      <Card sx={{ bgcolor: 'task.nutrition', border: 'none' }}>
        <CardContent>
          <Typography variant="h2">{plan.name}</Typography>
          <Typography color="text.secondary">
            {plan.kcal_target ?? '—'} kcal • {plan.protein_g ?? '—'}P {plan.carbs_g ?? '—'}C{' '}
            {plan.fat_g ?? '—'}F
          </Typography>
          {plan.notes ? (
            <Typography color="text.secondary" sx={{ mt: 1 }}>{plan.notes}</Typography>
          ) : null}
        </CardContent>
      </Card>

      <Stack spacing={2}>
        <Typography variant="h2">Day Types</Typography>

        {days.length === 0 ? (
          <EmptyState
            title="No days yet"
            description="This plan has no day types. Replace it to add some."
          />
        ) : null}

        {days.map((day) => (
          <Card key={day.id}>
            <CardContent>
              <Typography variant="h3" noWrap>{day.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {day.weekdays.length === 0
                  ? 'No days assigned'
                  : day.weekdays
                    .slice()
                    .sort((a, b) => a - b)
                    .map((d) => WEEKDAY_INITIALS[d])
                    .join(', ')}
                {' • '}{day.meals.length} meals
              </Typography>
              {day.meals.length > 0 ? (
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  {day.meals.map((meal) => (
                    <Typography key={meal.id} variant="body2" color="text.secondary">
                      {meal.name} — {String(meal.time_of_day).slice(0, 5)}
                      {meal.kcal == null ? '' : ` • ${meal.kcal} kcal`}
                    </Typography>
                  ))}
                </Stack>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Divider />

      <Button variant="outlined" size="large" fullWidth onClick={() => setReplacing(true)}>
        Create replacement plan
      </Button>
    </Stack>
  )
}
```

Note the `Button` import above requires adding `Button` to the MUI import
list (`Alert, Button, Card, CardContent, Divider, Stack, Typography`), shown
already in the Step 1 code block.

- [ ] **Step 2: Verify**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/nutrition/NutritionPlanEditorScreen.jsx
git commit -m "feat: rewrite the professional's nutrition screen as read/replace"
```

---

### Task 7: `MemberNutritionScreen.jsx` and `MealDetailScreen.jsx`

**Depends on:** Task 2 (`weekdayOf`), Task 3 (new `fetchNutritionPlan` shape).

**Files:**
- Modify: `src/features/nutrition/MemberNutritionScreen.jsx` (full rewrite)
- Modify: `src/features/nutrition/MealDetailScreen.jsx` (extend)

**Interfaces:**
- Consumes: `weekdayOf` (`src/lib/week.js`), `fetchNutritionPlan` (Task 3).

- [ ] **Step 1: Replace `MemberNutritionScreen.jsx`**

`WeekStrip` becomes real: selecting a day looks up which day type's
`weekdays` covers that weekday and renders its meals.

```jsx
import { useEffect, useRef, useState } from 'react'
import { Box, Button, Card, CardActionArea, CardContent, Divider, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { todayISO } from '../../lib/format.js'
import { weekdayOf } from '../../lib/week.js'
import { weekStrip } from '../calendar/month.js'
import WeekStrip from '../../components/WeekStrip.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/** One macro figure under the calorie target. */
function Macro({ label, grams }) {
  return (
    <Stack sx={{ alignItems: 'center', flexGrow: 1 }}>
      <Typography variant="h3" component="p">
        {grams ?? '—'}
        {grams == null ? '' : 'g'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )
}

export default function MemberNutritionScreen() {
  const { user } = useAuth()
  const [selected, setSelected] = useState(todayISO())

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(user.id),
    queryFn: () => fetchNutritionPlan(user.id),
  })

  // Fires once per mount, independent of how this screen was reached --
  // clears the "New nutrition plan" notification the same way visiting it
  // always would, bell or not (patches/020).
  const notified = useRef(false)
  const markNotificationsRead = useMutation({ mutationKey: mutationKeys.markNotificationsRead })
  useEffect(() => {
    if (notified.current) return
    notified.current = true
    markNotificationsRead.mutate({ url: '/m/nutrition' })
  }, [markNotificationsRead])

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  // `undefined` means not loaded; `null` means loaded and there is none.
  if (nutrition.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">Nutrition Plan</Typography>
        <Card>
          <CardContent>
            <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
              <Typography variant="h3" color="primary">
                You do not have a nutrition plan yet
              </Typography>
              <Typography color="text.secondary">
                Book an appointment with your professional and start your nutrition journey.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        <Button
          component={Link}
          to="/m/trainer/appointments"
          variant="contained"
          size="large"
          fullWidth
        >
          Book Appointment
        </Button>
      </Stack>
    )
  }

  const { plan, days } = nutrition.data
  const activeDay = days.find((day) => day.weekdays.includes(weekdayOf(selected))) ?? null
  const meals = activeDay?.meals ?? []

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Nutrition Plan</Typography>

      <Card sx={{ bgcolor: 'task.nutrition', border: 'none' }}>
        <CardContent>
          <Stack spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h2" component="p">
              {plan.name}
            </Typography>
            <Typography variant="h2" component="p">
              {plan.kcal_target ?? '—'} kcal
            </Typography>
            <Divider flexItem />
            <Stack direction="row" sx={{ width: '100%', pt: 1 }}>
              <Macro label="Proteins" grams={plan.protein_g} />
              <Macro label="Carbs" grams={plan.carbs_g} />
              <Macro label="Fats" grams={plan.fat_g} />
            </Stack>
            {plan.notes ? (
              <Typography color="text.secondary" sx={{ pt: 1 }}>{plan.notes}</Typography>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Your Week
        </Typography>
        <WeekStrip days={weekStrip(selected)} selected={selected} onSelect={setSelected} />
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          {activeDay ? activeDay.name : 'Daily Meals'}
        </Typography>

        {activeDay === null ? (
          <EmptyState
            title="No plan for this day"
            description="No day type in your plan covers this day of the week."
          />
        ) : meals.length === 0 ? (
          <EmptyState
            title="No meals added yet"
            description="Your professional has created this day but has not added its meals yet."
          />
        ) : (
          <Stack spacing={2}>
            {meals.map((meal) => (
              <Card key={meal.id}>
                <CardActionArea component={Link} to={`/m/nutrition/meal/${meal.id}`}>
                  <CardContent>
                    <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                      <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h3" noWrap>
                          {meal.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {String(meal.time_of_day).slice(0, 5)}
                          {meal.kcal == null ? '' : ` • ${meal.kcal} kcal`}
                        </Typography>
                      </Stack>
                      <ChevronRightIcon color="primary" />
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 2: Extend `MealDetailScreen.jsx`**

Replace the entire file: adds the three macro figures and the alternatives
text, and looks the meal up through `days` instead of the old flat `meals`
array.

```jsx
import { Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { useAuth } from '../auth/useAuth.js'

/** One macro figure. */
function Macro({ label, grams }) {
  return (
    <Stack sx={{ alignItems: 'center', flexGrow: 1 }}>
      <Typography variant="h3" component="p">
        {grams ?? '—'}
        {grams == null ? '' : 'g'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )
}

export default function MealDetailScreen() {
  const { mealId } = useParams()
  const { user } = useAuth()

  // Reuses the plan query rather than adding a per-meal read: the member
  // came from the plan screen, so this is served from cache and works
  // offline.
  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(user.id),
    queryFn: () => fetchNutritionPlan(user.id),
  })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  const meal = nutrition.data?.days.flatMap((day) => day.meals).find((m) => m.id === mealId)

  // A meal id that is not in the plan means it was deleted (replaced along
  // with the rest of its plan), or the URL was typed. Either way this is an
  // empty state, not a crash.
  if (!meal) {
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        <PageHeader title="Meal" backTo="/m/nutrition" backLabel="Back to nutrition plan" />
        <EmptyState
          title="Meal not found"
          description="This meal is no longer part of your plan."
        />
      </Stack>
    )
  }

  const items = Array.isArray(meal.items) ? meal.items : []
  const hasMacros = meal.protein_g != null || meal.carbs_g != null || meal.fat_g != null

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title={meal.name}
        subtitle={`${String(meal.time_of_day).slice(0, 5)}${
          meal.kcal == null ? '' : ` • ${meal.kcal} kcal`
        }`}
        backTo="/m/nutrition"
        backLabel="Back to nutrition plan"
      />

      {hasMacros ? (
        <Card>
          <CardContent>
            <Stack direction="row">
              <Macro label="Proteins" grams={meal.protein_g} />
              <Macro label="Carbs" grams={meal.carbs_g} />
              <Macro label="Fats" grams={meal.fat_g} />
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          {items.length === 0 ? (
            <Typography color="text.secondary">
              Your professional has not listed the items for this meal yet.
            </Typography>
          ) : (
            <Stack divider={<Divider />} spacing={1.5}>
              {items.map((item, index) => (
                <Stack key={index} direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
                  <Typography sx={{ flexGrow: 1 }}>{item.food}</Typography>
                  <Typography color="text.secondary">{item.qty}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {meal.alternatives ? (
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 1 }}>Alternatives</Typography>
            <Typography color="text.secondary">{meal.alternatives}</Typography>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  )
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/nutrition/MemberNutritionScreen.jsx \
  src/features/nutrition/MealDetailScreen.jsx
git commit -m "feat: make the member nutrition WeekStrip real, add meal macros"
```

---

### Task 8: `seed.sql` rewrite for the new schema

**Depends on:** Task 1 applied to the database.

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Add day-type locals to the `declare` block**

In the `do $$ declare ... begin` block (lines 16-24), add two locals after
`v_nut_id`:

```sql
  v_nut_id    uuid;
  v_day_a_id  uuid;
  v_day_b_id  uuid;
```

- [ ] **Step 2: Replace the nutrition fixture block**

Replace lines 107-120 (the `-- Nutrition plan` comment through the closing
`;` of the `insert into meals` statement) with:

```sql
  -- Nutrition plan: two day types, matching doc/nutrition_plan.md's
  -- "Giorni Tipo" example. Day A covers Mon/Wed/Fri, Day B the rest of the
  -- week -- deliberately not a 5/2 split, to demonstrate that a day type
  -- can cover a non-contiguous set of weekdays.
  insert into nutrition_plans (member_id, author_id, name, kcal_target, protein_g, carbs_g, fat_g, notes)
  values (v_member_id, v_pro_id, 'Lean Bulk', 2600, 170, 300, 75,
          '2.5L water/day. 1 tbsp olive oil per meal.')
  returning id into v_nut_id;

  insert into nutrition_days (id, plan_id, name, position, weekdays)
  values (gen_random_uuid(), v_nut_id, 'Day A', 1, array[1,3,5])
  returning id into v_day_a_id;

  insert into nutrition_days (id, plan_id, name, position, weekdays)
  values (gen_random_uuid(), v_nut_id, 'Day B', 2, array[0,2,4,6])
  returning id into v_day_b_id;

  insert into meals (day_id, name, time_of_day, position, kcal, protein_g, carbs_g, fat_g, alternatives, items) values
    (v_day_a_id, 'Breakfast', '07:30', 1, 520, 30, 60, 15,
     '200g egg whites, 4 crispbreads, 15g walnuts',
     '[{"food":"Oats","qty":"80 g"},{"food":"Whey","qty":"30 g"},{"food":"Banana","qty":"1"}]'),
    (v_day_a_id, 'Lunch', '13:00', 2, 820, 55, 90, 20,
     '80g farro, 150g turkey breast',
     '[{"food":"Chicken breast","qty":"200 g"},{"food":"Rice","qty":"120 g"},{"food":"Olive oil","qty":"10 g"}]'),
    (v_day_a_id, 'Snack', '17:00', 3, 380, 20, 30, 15,
     '1 whole egg, 10g almonds',
     '[{"food":"Greek yogurt","qty":"200 g"},{"food":"Almonds","qty":"25 g"}]'),
    (v_day_a_id, 'Dinner', '20:30', 4, 880, 50, 70, 30,
     '250g sea bass, 60g wholegrain bread',
     '[{"food":"Salmon","qty":"200 g"},{"food":"Potatoes","qty":"250 g"},{"food":"Salad","qty":"1 bowl"}]');

  insert into meals (day_id, name, time_of_day, position, kcal, protein_g, carbs_g, fat_g, alternatives, items) values
    (v_day_b_id, 'Breakfast', '07:30', 1, 480, 28, 55, 12,
     '150g Greek yogurt, 30g oats',
     '[{"food":"Eggs","qty":"3"},{"food":"Wholegrain bread","qty":"60 g"}]'),
    (v_day_b_id, 'Lunch', '13:00', 2, 780, 50, 85, 18,
     '80g quinoa, 150g cod',
     '[{"food":"Turkey breast","qty":"180 g"},{"food":"Pasta","qty":"100 g"},{"food":"Mixed vegetables","qty":"200 g"}]'),
    (v_day_b_id, 'Dinner', '20:30', 3, 720, 45, 55, 25,
     '200g tofu, 200g sweet potato',
     '[{"food":"Beef","qty":"180 g"},{"food":"Rice","qty":"100 g"},{"food":"Broccoli","qty":"200 g"}]');
```

- [ ] **Step 3: Hand off to Davide**

`seed.sql` runs by hand in the Supabase SQL editor. It is not idempotent
(see the file's own header) -- Davide must truncate first if the demo
database already holds nutrition data from before patch 022 (the header's
`truncate` line already covers `nutrition_plans`, and `nutrition_days`/
`meals` cascade from it, so no change is needed there). Report the file path
and wait for confirmation before Task 9's `verify.sql` checks are run
against it.

- [ ] **Step 4: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat: rewrite nutrition seed data for Day Types"
```

---

### Task 9: `verify.sql`, `probe-rls.mjs`, `CLAUDE.md` consistency updates

**Depends on:** Task 1 applied to the database (these checks assert against
the live schema).

**Files:**
- Modify: `supabase/verify.sql`
- Modify: `supabase/probe-rls.mjs`
- Modify: `CLAUDE.md`

Patch 022 adds one table (`nutrition_days`) and revokes direct `insert` on
two tables that previously allowed it (`nutrition_plans`, `meals`) plus the
new table. `verify.sql`'s aggregate counts must move with it -- this is the
same class of fix both prior features' whole-branch reviews caught after the
fact (once for the notifications table, once for a signature-overload
cleanup); doing it in this task avoids that review round entirely.

- [ ] **Step 1: Update `supabase/verify.sql`**

Header comment (lines 1, 7-8): change every `021` to `022`.

Table count (line 27), from:

```sql
    -- schema.sql declares 19 tables; patch 020's `notifications` makes 20.
    -- The historical create-if-missing patches remain safe to replay in order.
    ('public tables',
     (select count(*)::text from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'), '20'),
```

to:

```sql
    -- schema.sql declares 19 tables; patch 020's `notifications` and patch
    -- 022's `nutrition_days` make 21. The historical create-if-missing
    -- patches remain safe to replay in order.
    ('public tables',
     (select count(*)::text from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'), '21'),
```

RLS-enabled count (line 32), from `'20'` to `'21'`.

Tables-with-a-policy count (line 46), from `'19'` to `'20'` (`nutrition_days`
now carries `nutrition_days_select`).

Tables-the-app-role-can-read count (line 58), from `'19'` to `'20'`.

Tables-the-app-role-can-write count (lines 59-65), from:

```sql
    ('tables the app role can write',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'insert')),
     -- Patch 015 removes direct INSERT from the ten protected history and
     -- relationship tables. The remaining eight use ordinary RLS writes.
     '8'),
```

to:

```sql
    ('tables the app role can write',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'insert')),
     -- Patch 015 removed direct INSERT from ten protected tables; patch 022
     -- removes it from nutrition_plans and meals too (nutrition_days never
     -- had it). The remaining six use ordinary RLS writes.
     '6'),
```

Protected-tables list (lines 67-75), from:

```sql
    ('protected tables reject direct insert privileges',
     (select count(*)::text from (values
       ('workout_plans'), ('workout_sessions'), ('session_exercises'),
       ('workout_runs'), ('set_logs'), ('rewards'), ('appointments'),
       ('threads'), ('checkins'), ('body_metrics')
     ) as protected(tablename)
     where not has_table_privilege(
       'authenticated', format('public.%I', protected.tablename), 'insert')),
     '10'),
```

to:

```sql
    ('protected tables reject direct insert privileges',
     (select count(*)::text from (values
       ('workout_plans'), ('workout_sessions'), ('session_exercises'),
       ('workout_runs'), ('set_logs'), ('rewards'), ('appointments'),
       ('threads'), ('checkins'), ('body_metrics'), ('nutrition_plans'),
       ('nutrition_days'), ('meals')
     ) as protected(tablename)
     where not has_table_privilege(
       'authenticated', format('public.%I', protected.tablename), 'insert')),
     '13'),
```

- [ ] **Step 2: Update `supabase/probe-rls.mjs`**

Line 43, add `'nutrition_days'` to the `TABLES` array, next to
`'nutrition_plans'` and `'meals'`:

```js
  'set_logs', 'workout_runs', 'nutrition_plans', 'nutrition_days', 'meals', 'availability',
  'appointments',
```

- [ ] **Step 3: Update `CLAUDE.md`**

In the Database section, change the `patches/001`…`021` bullet's opening
clause to `patches/001`…`022`, and append one sentence about patch 022 in
the same style as the existing sentences about 017-019:

```
- `patches/001`…`022` — applied in order on top. They also carry their own
  PASS/FAIL blocks. `009` (checkin tokens) and `010` (push notifications) are
  what Phase 4B's badge, scanner and push features depend on; `011` hardens the
  three oldest `security definer` functions against pg_temp shadowing.
  `015` rewrites every write as a secure RPC and revokes direct table
  grants; `017` widens plan creation to the member themselves, not only
  their assigned professional; `018` lets one plan-creation call bundle
  any number of sessions; `019` grows the exercise catalogue; `022` moves
  Nutrition Plan to a Day Types structure and its own secure creation RPC,
  professional-only. All must be applied, in order, before the current
  branch's code will work against the database.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/verify.sql supabase/probe-rls.mjs CLAUDE.md
git commit -m "chore: update verify.sql, probe-rls.mjs and CLAUDE.md for patch 022"
```

---

### Task 10: End-to-end verification

**Depends on:** Tasks 1-9, patches 022 and the rewritten `seed.sql` applied
by Davide.

- [ ] **Step 1: Build and lint**

Run: `npm run lint && npm run build`
Expected: both succeed with no errors.

- [ ] **Step 2: Run every registered selfcheck**

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

Expected: every one prints its own `OK` line, `src/lib/week.selfcheck.js`
included (extended in Task 2).

- [ ] **Step 3: `probe-rls.mjs`**

Run: `node supabase/probe-rls.mjs` (needs `.env.local`)
Expected: `nutrition_days` reports the same anonymous-read shape as
`nutrition_plans` and `meals` -- readable under RLS, but only rows an
authenticated, assigned caller can see; nothing readable as `anon`.

- [ ] **Step 4: `verify.sql`**

Hand off to Davide: run `supabase/verify.sql` in the SQL editor after patch
022 and the rewritten `seed.sql`. Every row must read PASS.

- [ ] **Step 5: Manual test script for Davide**

Hand Davide this scenario list:

1. As Coach Andrea, open a client with no nutrition plan -- the wizard
   appears; create a plan with two day types (e.g. Day A: Mon/Wed/Fri, Day B:
   the rest), each with at least one meal carrying macros and an
   alternative; confirm; the screen becomes read-only and shows both days.
2. As Daniel, open Nutrition -- the plan appears; the Week strip actually
   changes which day's meals are shown as you tap through the week; a day
   with no covering day type shows the "No plan for this day" empty state;
   opening a meal shows its macros and alternatives alongside the food
   items.
3. As Coach Andrea, on the client's now-existing plan, tap "Create
   replacement plan" -- the Alert about history appears, a full new wizard
   runs, and confirming makes the new plan the one both roles see; the old
   plan is gone from the read view (still in the database, per
   `replaces_plan_id`).
4. Abandon a wizard mid-draft (both on first creation and on a replacement)
   -- confirm the dialog appears, confirm it discards, and the previous
   state (no plan, or the old plan) is unchanged.
5. Go offline mid-wizard, confirm the plan -- the "saved on your device"
   `Alert` appears and the button reads "Saved offline"; reconnect and
   confirm the plan lands.

- [ ] **Step 6: Ledger entry**

Once Davide confirms the manual test script and `verify.sql`, append to
`.superpowers/sdd/progress.md`, matching the format of the three prior
merged features (hotfix-security-integrity, workout-creation-wizard,
notification-center).
