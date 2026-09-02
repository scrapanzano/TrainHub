-- Patch 018 -- create a workout plan with any number of sessions at once.
--
-- create_workout_plan_secure (patches/015, authorization widened by
-- patches/017) took exactly one session bundle, matching the old two-step
-- creation flow. The new wizard drafts as many sessions as the member or
-- professional wants before writing anything, so the trailing p_session_id/
-- p_session_name/p_exercises become one p_sessions array, one element per
-- drafted session, each shaped the way public._insert_session_bundle
-- already expects its own arguments.
--
-- Every session in the array commits in the same transaction as the plan
-- itself (a plpgsql function body already is one transaction), so this stays
-- atomic exactly as patches/015 first made it. The replay check is
-- unchanged: it compares only plan-level fields, which is correct because a
-- plan row and its sessions are only ever written together -- if the plan
-- row already exists with matching fields, its sessions were already
-- inserted by that same earlier call.
--
-- The old 10-argument signature is a DIFFERENT overload as far as Postgres
-- is concerned (create or replace matches by full parameter signature, not
-- by name alone) -- dropped explicitly first, or it would linger alongside
-- the new one and make every self-check below ambiguous.
--
-- Idempotent: safe to replay.

begin;

drop function if exists public.create_workout_plan_secure(
  uuid, uuid, uuid, text, text, text, int, uuid, text, jsonb);

create or replace function public.create_workout_plan_secure(
  p_plan_id uuid, p_member_id uuid, p_replaces_plan_id uuid,
  p_name text, p_goal text, p_level text, p_weeks int,
  p_sessions jsonb
) returns setof public.workout_plans
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_current uuid;
  v_row public.workout_plans%rowtype;
  v_session jsonb;
begin
  perform 1 from public.profiles member
  where member.id = p_member_id and member.role = 'member' for update;
  if not found or not public.owns_member(p_member_id) then
    raise exception 'not authorized to create this plan for this member'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) = 0 then
    raise exception 'a plan needs at least one session' using errcode = '22023';
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

  for v_session in select * from jsonb_array_elements(p_sessions)
  loop
    perform public._insert_session_bundle(
      (v_session->>'id')::uuid, p_plan_id, v_session->>'name',
      (v_session->>'position')::int, v_session->'exercises');
  end loop;

  return next v_row;
end;
$$;

revoke execute on function public.create_workout_plan_secure(
  uuid, uuid, uuid, text, text, text, int, jsonb
) from public, anon;
grant execute on function public.create_workout_plan_secure(
  uuid, uuid, uuid, text, text, text, int, jsonb
) to authenticated;

drop table if exists pg_temp.patch_018_checks;
create temporary table patch_018_checks (
  check_name text not null,
  actual text,
  expected text not null
) on commit preserve rows;

insert into patch_018_checks (check_name, actual, expected) values
  ('the old single-session overload is gone',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   '1'),
  ('plan creation loops over multiple sessions',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%jsonb_array_elements(p_sessions)%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   'true'),
  ('self-authorship check is still in place',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%notpublic.owns_member(p_member_id)%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   'true'),
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
     'public.create_workout_plan_secure(uuid,uuid,uuid,text,text,text,int,jsonb)',
     'execute')::text,
   'true'),
  ('anonymous caller cannot create a plan',
   has_function_privilege(
     'anon',
     'public.create_workout_plan_secure(uuid,uuid,uuid,text,text,text,int,jsonb)',
     'execute')::text,
   'false');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_018_checks
order by check_name;
