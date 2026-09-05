-- 026 — Stamp a check-in reward with the same day everything else uses.
--
-- WHAT WENT WRONG
--
-- `patches/024` pays ten points for a gym check-in, keyed one per member per
-- day by `unique (member_id, code)` on a code of `checkin:<date>`. It builds
-- that date, and `reward_day`, from `current_date` — the DATABASE's day, which
-- on Supabase is UTC.
--
-- `close_workout_run_secure` (patches/023) does not. It stamps
-- `reward_day := (v_row.started_at at time zone 'Europe/Rome')::date`, the
-- day the member actually trained on. So the two reward writers disagree about
-- what "today" means, and they disagree for the two hours after midnight in
-- Rome — one hour in winter.
--
-- Both directions are wrong, and they are wrong in opposite ways:
--
--   * A member who scans at 00:30 Rome and again at 10:00 the same morning is
--     stamped `checkin:<yesterday>` and then `checkin:<today>`. Two rows, twenty
--     points, one Italian day. The daily cap the code was designed to be does
--     not hold.
--   * A member who scans at 23:00 and again at 00:30 — two different Italian
--     days — gets `checkin:<same UTC day>` twice, the second silently swallowed
--     by ON CONFLICT. Points they earned, refused.
--
-- THE FIX
--
-- One clock for one concept. `v_day` is the Rome day, exactly as
-- `close_workout_run_secure` computes it, and both the code and `reward_day`
-- are built from it.
--
-- `current_date` REMAINS in the access check below, deliberately. That
-- comparison is `subscription_until < current_date` — a `date` column holding a
-- calendar date against the calendar date. Moving it into Rome would shift when
-- a membership stops opening the door by up to two hours, which is a different
-- decision from this one and not an improvement.
--
-- NO BACKFILL. Rows already written by `patches/024` keep their UTC-day stamp.
-- Rewriting them could collide two members' `checkin:<date>` codes against the
-- unique constraint, and the demo database is rebuilt by `seed.sql` anyway.
-- `verify.sql` accepts a check-in reward matched in EITHER day frame for
-- exactly this reason; leave that tolerance in place.
--
-- The function is reproduced whole from `patches/024` — including the
-- `set search_path = ''` hardening from `patches/011` — with the two lines
-- changed and one variable added. plpgsql has no way to amend a body, and a
-- diff against 024 is the only honest way to review this.
--
-- Idempotent: `create or replace`, safe to replay.
--
-- Apply in the Supabase SQL editor, after 001–025.

begin;

create or replace function public.redeem_checkin_token(p_token text)
returns table (
  status              text,
  member_id           uuid,
  full_name           text,
  subscription_status text,
  subscription_until  date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token  public.checkin_tokens%rowtype;
  v_member public.profiles%rowtype;
  v_access text;
  -- NEW IN 026: the day this check-in belongs to, in the frame the member
  -- lives in and the frame every workout reward already uses.
  v_day    date := (now() at time zone 'Europe/Rome')::date;
begin
  if not public.is_professional() then
    raise exception 'only a professional may redeem a badge'
      using errcode = '42501';
  end if;

  -- First discover the owner without locking. The durable lock order is then
  -- member -> token, matching the profile-to-token order used by a cascading
  -- profile deletion. The scanner's role is rechecked without another lock.
  select token_row.* into v_token
  from public.checkin_tokens token_row
  where token_row.token = p_token;

  if not found then
    return query select 'unknown'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  select member.* into v_member
  from public.profiles member
  where member.id = v_token.member_id
    and member.role = 'member'
  for share;

  if not found then
    return query select 'unknown'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  perform 1
  from public.profiles pro
  where pro.id = auth.uid() and pro.role = 'professional';
  if not found then
    raise exception 'only a professional may redeem a badge'
      using errcode = '42501';
  end if;

  -- Re-read under lock: another scanner may have consumed it after the first
  -- lookup and before the profile locks were acquired.
  select token_row.* into v_token
  from public.checkin_tokens token_row
  where token_row.id = v_token.id
  for update;

  if not found then
    return query select 'unknown'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  if v_token.used_at is not null then
    return query select 'used'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  if v_token.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  -- `current_date` here on purpose -- see the header. This compares a calendar
  -- date column against the calendar date, and is not the same question as
  -- which day a check-in belongs to.
  v_access := case
    when v_member.subscription_status = 'suspended' then 'suspended'
    when v_member.subscription_status = 'expired'
      or (v_member.subscription_until is not null
          and v_member.subscription_until < current_date) then 'expired'
    else 'active'
  end;

  if v_access <> 'active' then
    return query
      select v_access, v_member.id, v_member.full_name,
             v_access, v_member.subscription_until;
    return;
  end if;

  update public.checkin_tokens
  set used_at = now()
  where id = v_token.id;

  insert into public.checkins (member_id, scanned_by_id)
  values (v_token.member_id, auth.uid());

  -- Ten points for the day, once. CHANGED IN 026: `v_day` rather than
  -- `current_date`, so the cap covers the member's day and not the server's.
  -- Deriving it from the scanner's device would still be wrong -- a front desk
  -- an hour off would award two rewards across midnight -- so it stays a server
  -- clock, just the right one.
  --
  -- `reward_day` cannot collide with the workout rows:
  -- `rewards_one_workout_per_session_day_idx` is partial on
  -- `workout_session_id is not null`, which this row leaves null.
  --
  -- Named constraint, not `on conflict (member_id, code)`. This function
  -- returns a table whose second column is `member_id`, so that name is also a
  -- plpgsql OUT variable in this body, and an inference clause mentioning it is
  -- ambiguous -- 42702 at scan time, from a function that installs cleanly.
  -- `close_workout_run_secure` gets away with the column form only because it
  -- returns `setof workout_runs` and has no such variable.
  insert into public.rewards (member_id, reward_day, code, title, description, points)
  values (
    v_token.member_id, v_day,
    'checkin:' || v_day::text,
    'Gym check-in',
    'Checked in at the gym',
    10
  )
  on conflict on constraint rewards_member_id_code_key do nothing;

  return query
    select 'ok'::text, v_member.id, v_member.full_name,
           'active'::text, v_member.subscription_until;
end;
$$;

-- Re-asserted rather than assumed: `create or replace` keeps the existing
-- grants, but a patch that recreates a security-definer function and does not
-- restate them leaves the next reader guessing.
revoke execute on function public.redeem_checkin_token(text)
  from public, anon;
grant execute on function public.redeem_checkin_token(text)
  to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- PASS / FAIL
--
-- One query: the Supabase SQL editor renders only the LAST statement of a
-- script, so a file of separate SELECTs silently shows you just the final one.
-- Every row must read PASS.
--
-- No temporary table here on purpose. `patches/018` and `022` use one with
-- `on commit preserve rows` and it works, but the editor's handling of session
-- state across statements is not something to lean on -- rebuilding `seed.sql`
-- cost two rounds to that. A single statement cannot be caught out by it.
-- ---------------------------------------------------------------------------

select
  check_name,
  coalesce(actual, '(null)') as actual,
  expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('the reward day is now the Rome day',
     (select coalesce(
        regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
          like '%v_daydate:=(now()attimezone''europe/rome'')::date%',
        false)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_checkin_token'),
     'true'),

    ('the reward code no longer uses current_date',
     (select coalesce(
        regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
          like '%''checkin:''||current_date%',
        false)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_checkin_token'),
     'false'),

    -- The access check is deliberately untouched. If this ever reads false,
    -- someone "tidied" a comparison that was correct.
    ('the subscription check still compares calendar dates',
     (select coalesce(
        regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
          like '%subscription_until<current_date%',
        false)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_checkin_token'),
     'true'),

    ('it agrees with close_workout_run_secure on the day frame',
     (select count(*)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('redeem_checkin_token', 'close_workout_run_secure')
        and lower(pg_get_functiondef(p.oid)) like '%at time zone ''europe/rome''%'),
     '2'),

    ('still security definer with search_path pinned',
     (select (p.prosecdef and coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false))::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'redeem_checkin_token'),
     'true'),

    ('authenticated may execute it',
     has_function_privilege(
       'authenticated', 'public.redeem_checkin_token(text)', 'execute')::text,
     'true'),

    ('anon may not',
     has_function_privilege(
       'anon', 'public.redeem_checkin_token(text)', 'execute')::text,
     'false')
) as t(check_name, actual, expected)
order by check_name;
