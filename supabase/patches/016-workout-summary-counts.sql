-- Patch 016 -- correct workout completion percentages and rewards.
--
-- PostgreSQL ignores null arguments in LEAST/GREATEST. The old expression
-- LEAST(logged.amount, target_sets) therefore treated a missing log count as
-- target_sets, making every untouched exercise look complete. This patch uses
-- an explicit zero and repairs summaries and linked rewards already written by
-- the affected function.
--
-- Patch 015 now includes the corrected expression so a fresh installation is
-- born correct. Patch 016 remains necessary for a database that ran the older
-- revision of 015: replacing the function alone would not repair summaries or
-- rewards already stored by that revision.
--
-- Also repairs `rewards` rows written before `run_id` existed on this table
-- (`run_id`/`workout_session_id`/`reward_day` null, `code` already set) --
-- otherwise those rows are invisible to every join below and the final
-- insert collides with them on `rewards_member_id_code_key`.
--
-- Idempotent: the function replacement and repair can be replayed safely.

begin;

create or replace function public.close_workout_run_secure(
  p_run_id uuid, p_ended_at timestamptz, p_outcome public.run_outcome
) returns setof public.workout_runs
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.workout_runs%rowtype; v_target int; v_done int;
  v_pct int; v_points int; v_session_name text;
  v_outcome public.run_outcome; v_reward_day date;
begin
  select run.* into v_row from public.workout_runs run
  where run.id = p_run_id and run.member_id = auth.uid() for update;
  if not found then raise exception 'run not found' using errcode = '42501'; end if;
  v_reward_day := (v_row.started_at at time zone 'Europe/Rome')::date;
  if p_outcome is null then
    raise exception 'run outcome is required' using errcode = '22023';
  end if;
  if v_row.ended_at is not null then
    if v_row.ended_at is distinct from p_ended_at
       or ((v_row.outcome = 'abandoned') is distinct from (p_outcome = 'abandoned')) then
      raise exception 'run was already closed differently' using errcode = '40001';
    end if;
    return next v_row; return;
  end if;
  if p_ended_at < v_row.started_at then
    raise exception 'run end precedes start' using errcode = '22023';
  end if;

  select coalesce(sum(item.target_sets), 0), session.name
  into v_target, v_session_name
  from public.workout_sessions session
  left join public.session_exercises item on item.session_id = session.id
  where session.id = v_row.session_id group by session.name;
  select coalesce(
    sum(least(coalesce(logged.amount, 0), item.target_sets)), 0)
  into v_done
  from public.session_exercises item
  left join (
    select session_exercise_id, count(*)::int amount from public.set_logs
    where run_id = p_run_id group by session_exercise_id
  ) logged on logged.session_exercise_id = item.id
  where item.session_id = v_row.session_id;
  v_pct := case when v_target = 0 then 0 else floor(100.0 * v_done / v_target) end;
  v_outcome := case when p_outcome = 'abandoned' then 'abandoned'::public.run_outcome
    when v_target > 0 and v_done >= v_target then 'completed'::public.run_outcome
    else 'partial'::public.run_outcome end;
  v_points := case when v_outcome = 'abandoned' or v_target = 0 then 0
    else floor(30.0 * v_done / v_target) end;

  if v_row.paused_at is not null and p_ended_at >= v_row.paused_at then
    v_row.paused_total_ms := v_row.paused_total_ms
      + floor(extract(epoch from (p_ended_at - v_row.paused_at)) * 1000);
  end if;
  update public.workout_runs set ended_at = p_ended_at, outcome = v_outcome,
    pct = v_pct, paused_at = null, paused_total_ms = v_row.paused_total_ms
  where id = p_run_id returning * into v_row;

  if v_points > 0 then
    insert into public.rewards (
      member_id, run_id, workout_session_id, reward_day, code, title, points
    ) values (
      v_row.member_id, v_row.id, v_row.session_id, v_reward_day,
      'workout:' || v_row.id,
      case when v_outcome = 'completed' then 'Completed ' || v_session_name
           else v_session_name || ' - ' || v_pct || '%' end,
      v_points
    ) on conflict (member_id, workout_session_id, reward_day)
      where workout_session_id is not null and reward_day is not null
      do nothing;
  end if;
  return next v_row;
end;
$$;

revoke execute on function public.close_workout_run_secure(
  uuid,timestamptz,public.run_outcome
) from public, anon;
grant execute on function public.close_workout_run_secure(
  uuid,timestamptz,public.run_outcome
) to authenticated;

-- Backfill reward rows written before `run_id` was populated on this table.
-- `code` has always been `'workout:' || run_id`, so the id is recoverable
-- from it. Without this, every join below (all keyed on `reward.run_id`) is
-- blind to these rows: they are never deduplicated or deleted, and the final
-- insert collides with them on `rewards_member_id_code_key`, a constraint its
-- `on conflict (member_id, workout_session_id, reward_day)` does not cover.
--
-- A code-encoded id with no matching row in `workout_runs` is a reward for a
-- run deleted before this column existed -- setting it would violate
-- `rewards_run_fk`, so it is deleted outright rather than backfilled.
delete from public.rewards reward
where reward.run_id is null
  and reward.code like 'workout:%'
  and not exists (
    select 1 from public.workout_runs run
    where run.id = substring(reward.code from 9)::uuid
  );

update public.rewards
set run_id = substring(code from 9)::uuid
where run_id is null
  and code like 'workout:%';

-- Calculate the correct value for every closed run. Abandoned is an explicit
-- user decision and remains abandoned; percentages still reflect work logged.
drop table if exists pg_temp.patch_016_run_values;
create temporary table patch_016_run_values on commit preserve rows as
with totals as (
  select
    run.id as run_id,
    run.member_id,
    run.session_id,
    run.started_at,
    run.ended_at,
    run.outcome as stored_outcome,
    session.name as session_name,
    coalesce(sum(item.target_sets), 0)::int as target_sets,
    coalesce(sum(
      case when item.id is null then 0
           else least(coalesce(logged.amount, 0), item.target_sets)
      end
    ), 0)::int as completed_sets
  from public.workout_runs run
  join public.workout_sessions session on session.id = run.session_id
  left join public.session_exercises item on item.session_id = session.id
  left join (
    select run_id, session_exercise_id, count(*)::int as amount
    from public.set_logs
    group by run_id, session_exercise_id
  ) logged on logged.run_id = run.id
          and logged.session_exercise_id = item.id
  where run.ended_at is not null
  group by run.id, run.member_id, run.session_id, run.started_at,
           run.ended_at, run.outcome, session.name
)
select totals.*,
  case when target_sets = 0 then 0
       else floor(100.0 * completed_sets / target_sets)::int
  end as correct_pct,
  case
    when stored_outcome = 'abandoned' then 'abandoned'::public.run_outcome
    when target_sets > 0 and completed_sets >= target_sets
      then 'completed'::public.run_outcome
    else 'partial'::public.run_outcome
  end as correct_outcome,
  case when stored_outcome = 'abandoned' or target_sets = 0 then 0
       else floor(30.0 * completed_sets / target_sets)::int
  end as correct_points,
  (started_at at time zone 'Europe/Rome')::date as correct_reward_day
from totals;

update public.workout_runs run
set pct = value.correct_pct,
    outcome = value.correct_outcome
from pg_temp.patch_016_run_values value
where run.id = value.run_id
  and (run.pct is distinct from value.correct_pct
       or run.outcome is distinct from value.correct_outcome);

-- Keep an existing eligible reward when possible. If the old bug awarded a
-- zero-work run, the earliest genuinely eligible run becomes that day's one
-- reward for the session.
drop table if exists pg_temp.patch_016_reward_winners;
create temporary table patch_016_reward_winners on commit preserve rows as
select distinct on (value.member_id, value.session_id, value.correct_reward_day)
  value.*
from pg_temp.patch_016_run_values value
left join public.rewards reward on reward.run_id = value.run_id
where value.correct_points > 0
order by value.member_id, value.session_id, value.correct_reward_day,
         (reward.id is not null) desc, value.ended_at, value.run_id;

delete from public.rewards reward
using pg_temp.patch_016_run_values value
where reward.run_id = value.run_id
  and not exists (
    select 1 from pg_temp.patch_016_reward_winners winner
    where winner.run_id = reward.run_id
  );

update public.rewards reward
set member_id = winner.member_id,
    workout_session_id = winner.session_id,
    reward_day = winner.correct_reward_day,
    code = 'workout:' || winner.run_id,
    title = case
      when winner.correct_outcome = 'completed'
        then 'Completed ' || winner.session_name
      else winner.session_name || ' - ' || winner.correct_pct || '%'
    end,
    points = winner.correct_points
from pg_temp.patch_016_reward_winners winner
where reward.run_id = winner.run_id;

insert into public.rewards (
  member_id, run_id, workout_session_id, reward_day, code, title, points
)
select winner.member_id, winner.run_id, winner.session_id,
       winner.correct_reward_day, 'workout:' || winner.run_id,
       case when winner.correct_outcome = 'completed'
              then 'Completed ' || winner.session_name
            else winner.session_name || ' - ' || winner.correct_pct || '%'
       end,
       winner.correct_points
from pg_temp.patch_016_reward_winners winner
where not exists (
  select 1 from public.rewards reward where reward.run_id = winner.run_id
)
on conflict (member_id, workout_session_id, reward_day)
  where workout_session_id is not null and reward_day is not null
  do nothing;

drop table if exists pg_temp.patch_016_checks;
create temporary table patch_016_checks (
  check_name text not null,
  actual text,
  expected text not null
) on commit preserve rows;

insert into patch_016_checks (check_name, actual, expected) values
  ('no orphaned reward rows remain',
   (select (count(*) = 0)::text
    from public.rewards
    where run_id is null and code like 'workout:%'),
   'true'),
  ('unlogged exercises count as zero in the function',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%least(coalesce(logged.amount,0),item.target_sets)%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'close_workout_run_secure'),
   'true'),
  ('closed run summaries match their set logs',
   (select (count(*) = 0)::text
    from pg_temp.patch_016_run_values value
    join public.workout_runs run on run.id = value.run_id
    where run.pct is distinct from value.correct_pct
       or run.outcome is distinct from value.correct_outcome),
   'true'),
  ('only corrected daily workout reward winners remain',
   ((not exists (
       select 1 from public.rewards reward
       where reward.run_id is not null
         and not exists (
           select 1 from pg_temp.patch_016_reward_winners winner
           where winner.run_id = reward.run_id
         )
     ) and not exists (
       select 1 from pg_temp.patch_016_reward_winners winner
       where not exists (
         select 1 from public.rewards reward
         where reward.run_id = winner.run_id
           and reward.member_id = winner.member_id
           and reward.workout_session_id = winner.session_id
           and reward.reward_day = winner.correct_reward_day
           and reward.points = winner.correct_points
       )
     ))::text),
   'true'),
  ('close operation remains hardened',
   (select (count(*) = 1)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'close_workout_run_secure'
      and p.prosecdef and coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false)),
   'true'),
  ('authenticated caller can close a run',
   has_function_privilege(
     'authenticated',
     'public.close_workout_run_secure(uuid,timestamp with time zone,public.run_outcome)',
     'execute')::text,
   'true'),
  ('anonymous caller cannot close a run',
   has_function_privilege(
     'anon',
     'public.close_workout_run_secure(uuid,timestamp with time zone,public.run_outcome)',
     'execute')::text,
   'false');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_016_checks
order by check_name;
