-- Patch 017 -- restore member self-authored workout plans.
--
-- Patch 015 rewrote plan creation as an atomic, secure RPC but authorized
-- only the assigned professional to call it, dropping the member's own
-- ability to create a workout plan -- a previously agreed requirement, not
-- an intentional change of scope.
--
-- The fix reuses `public.owns_member(target)` (patches/011), already the
-- project's standard "self or assigned professional" predicate, in place of
-- the hand-rolled professional-only check. Everything else in the function
-- -- the atomic plan/session/exercise bundle, the replay check, the
-- optimistic-concurrency check on `replaces_plan_id` -- is unchanged.
--
-- `create_workout_session_secure` and `add_session_exercise_secure` are not
-- touched: no member-facing route calls them any more (patches/015 already
-- redirects `/m/workout/session/new` and `/m/workout/session/:id/exercise/
-- new` to `/m/workout` for members), so their author-must-be-assigned-
-- professional check never runs on a member's behalf.
--
-- Idempotent: `create or replace` can be replayed safely.

begin;

create or replace function public.create_workout_plan_secure(
  p_plan_id uuid, p_member_id uuid, p_replaces_plan_id uuid,
  p_name text, p_goal text, p_level text, p_weeks int,
  p_session_id uuid, p_session_name text, p_exercises jsonb
) returns setof public.workout_plans
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_current uuid;
  v_row public.workout_plans%rowtype;
begin
  perform 1 from public.profiles member
  where member.id = p_member_id and member.role = 'member' for update;
  if not found or not public.owns_member(p_member_id) then
    raise exception 'not authorized to create this plan for this member'
      using errcode = '42501';
  end if;

  select plan.* into v_row from public.workout_plans plan
  where plan.id = p_plan_id;
  if found then
    if v_row.member_id is distinct from p_member_id
       or v_row.author_id is distinct from v_actor
       or v_row.name is distinct from p_name
       or v_row.goal is distinct from nullif(p_goal, '')
       or v_row.level is distinct from nullif(p_level, '')
       or v_row.weeks is distinct from p_weeks
       or v_row.replaces_plan_id is distinct from p_replaces_plan_id then
      raise exception 'plan id is already used by different content'
        using errcode = '23505';
    end if;
    return next v_row;
    return;
  end if;

  select plan.id into v_current from public.workout_plans plan
  where plan.member_id = p_member_id
  order by plan.created_at desc, plan.id desc limit 1;
  if v_current is distinct from p_replaces_plan_id then
    raise exception 'the member plan changed before this save arrived'
      using errcode = '40001';
  end if;

  insert into public.workout_plans (
    id, member_id, author_id, name, goal, level, weeks, replaces_plan_id
  ) values (
    p_plan_id, p_member_id, v_actor, p_name, nullif(p_goal, ''),
    nullif(p_level, ''), p_weeks, p_replaces_plan_id
  ) returning * into v_row;

  perform public._insert_session_bundle(
    p_session_id, p_plan_id, p_session_name, 1, p_exercises);
  return next v_row;
end;
$$;

drop table if exists pg_temp.patch_017_checks;
create temporary table patch_017_checks (
  check_name text not null,
  actual text,
  expected text not null
) on commit preserve rows;

insert into patch_017_checks (check_name, actual, expected) values
  ('a member may author their own plan',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%not public.owns_member(p_member_id)%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   'true'),
  ('professional-only check is gone',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%is_professional%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   'false'),
  ('operation remains hardened',
   (select (count(*) = 1)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'
      and p.prosecdef and coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false)),
   'true'),
  ('authenticated caller can create a plan',
   has_function_privilege(
     'authenticated',
     'public.create_workout_plan_secure(uuid,uuid,uuid,text,text,text,int,uuid,text,jsonb)',
     'execute')::text,
   'true'),
  ('anonymous caller cannot create a plan',
   has_function_privilege(
     'anon',
     'public.create_workout_plan_secure(uuid,uuid,uuid,text,text,text,int,uuid,text,jsonb)',
     'execute')::text,
   'false');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_017_checks
order by check_name;
