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
