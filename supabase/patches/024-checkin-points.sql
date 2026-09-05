-- 024 — Points for showing up.
--
-- Until now `rewards` had exactly one source: closing a workout run, worth up
-- to 30 points weighted by the prescribed sets actually logged. `doc/review.md`
-- asked for a second one, so that walking into the gym counts for something
-- even on a day the member does not train.
--
-- Ten points, a third of a full workout. The ratio is the message: turning up
-- counts, training counts three times as much.
--
-- Three things this patch deliberately does NOT add:
--
--   * No new unique index. `rewards` already carries `unique (member_id, code)`
--     from `schema.sql`, so a code of `checkin:<date>` is one row per member
--     per day by construction. A second scan the same afternoon conflicts and
--     does nothing.
--   * No subscription check. `redeem_checkin_token` already returns
--     'suspended' or 'expired' and stops before recording the check-in at all,
--     so anything placed after that point is gated already. Repeating the test
--     here would imply the two could disagree.
--   * No change to the function's signature or its answers. The scanner is
--     untouched: a professional scanning a badge is told the same five things
--     as before, and the points are the member's business, not theirs.
--
-- The function below is re-created verbatim from `patches/015-essential-
-- security.sql` — including the `set search_path = ''` hardening from
-- `patches/011` — with one insert added. Reproduced whole rather than patched
-- in place because plpgsql has no way to amend a body, and a diff against 015
-- is the only honest way to review this.
--
-- Apply in the Supabase SQL editor, after 001–023 and alongside 025.

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

  -- NEW IN 024 -------------------------------------------------------------
  -- Ten points for the day, once. `current_date` is the database's day, the
  -- same clock that stamped the check-in a line above; deriving it from the
  -- scanner's device would let a front desk an hour off award two rewards
  -- across midnight.
  --
  -- `reward_day` is set for consistency with the workout rows, and cannot
  -- collide with them: `rewards_one_workout_per_session_day_idx` is partial on
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
    v_token.member_id, current_date,
    'checkin:' || current_date::text,
    'Gym check-in',
    'Checked in at the gym',
    10
  )
  on conflict on constraint rewards_member_id_code_key do nothing;
  -- END NEW ----------------------------------------------------------------

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
-- Run after the commit above. Every row must read PASS.
-- ---------------------------------------------------------------------------

select
  'function still security definer, search_path pinned' as check,
  case when p.prosecdef and array_to_string(p.proconfig, ',') like '%search_path=%'
       then 'PASS' else 'FAIL' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'redeem_checkin_token';

select
  'anon cannot execute it' as check,
  case when has_function_privilege('anon', 'public.redeem_checkin_token(text)', 'execute')
       then 'FAIL' else 'PASS' end as result;

select
  'authenticated can execute it' as check,
  case when has_function_privilege('authenticated', 'public.redeem_checkin_token(text)', 'execute')
       then 'PASS' else 'FAIL' end as result;

-- The once-per-day rule rests entirely on this constraint, and the function
-- body now names it directly, so the NAME matters and not merely the columns.
-- `schema.sql` declares it inline and unnamed, which Postgres auto-names
-- `rewards_member_id_code_key`; if that ever differs here, the insert above
-- fails at scan time rather than at install time, so it is asserted.
select
  'rewards_member_id_code_key exists, on (member_id, code)' as check,
  case when exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    where ns.nspname = 'public' and t.relname = 'rewards' and c.contype = 'u'
      and c.conname = 'rewards_member_id_code_key'
      and pg_get_constraintdef(c.oid) like '%member_id%code%'
  ) then 'PASS' else 'FAIL' end as result;

-- The award is inside the function body, not merely intended.
select
  'the reward insert is present' as check,
  case when pg_get_functiondef(p.oid) like '%checkin:%' then 'PASS' else 'FAIL' end as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'redeem_checkin_token';

-- ---------------------------------------------------------------------------
-- Behavioural probe.
--
-- The five checks above verify that the code is INSTALLED. None of them ran
-- it, which is how an `on conflict (member_id, code)` that is ambiguous inside
-- this particular function passed all of them and then failed on the first
-- real scan.
--
-- This block reproduces the one condition that made it ambiguous -- a local
-- named `member_id` shadowing the column, exactly as the function's OUT
-- parameter does -- and executes the real insert. Wrapped in its own
-- transaction and rolled back, so it writes nothing.
--
-- Run it as a separate statement, after the checks above.
-- ---------------------------------------------------------------------------

begin;
do $$
declare
  member_id uuid;          -- deliberately shadowing, as the function does
  v_member  uuid;
begin
  select p.id into v_member from public.profiles p where p.role = 'member' limit 1;
  if v_member is null then
    raise notice 'SKIP: no member row to probe with';
    return;
  end if;

  insert into public.rewards (member_id, reward_day, code, title, description, points)
  values (v_member, current_date, 'probe:' || gen_random_uuid()::text,
          'probe', 'rolled back', 0)
  on conflict on constraint rewards_member_id_code_key do nothing;

  raise notice 'PASS: the insert resolves with member_id shadowed';
end $$;
rollback;

-- Nothing survives the probe: this must return 0.
select
  'probe left nothing behind' as check,
  case when count(*) = 0 then 'PASS' else 'FAIL' end as result
from public.rewards where code like 'probe:%';
