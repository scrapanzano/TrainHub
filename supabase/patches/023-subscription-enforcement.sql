-- Patch 023 -- give subscription_status / subscription_until real teeth.
--
-- Until now these two columns drove exactly one thing: redeem_checkin_token
-- refuses a badge scan for a suspended / expired / date-elapsed member
-- (patches/015). Everywhere else the state was decorative -- a suspended
-- member still booked sessions and earned reward points, and a professional
-- could still build them a plan.
--
-- This patch:
--   1. adds public.has_active_subscription(member) -- the boolean twin of the
--      redeem_checkin_token CASE, so the rule lives in one place;
--   2. adds public.set_subscription_status_secure(member, status) -- the
--      professional-side button's write. An explicit SIMULATION of the gym's
--      billing server confirming payment; a real deployment would not let a
--      trainer flip this;
--   3. threads has_active_subscription() into close_workout_run_secure (no
--      reward row while inactive), create_workout_plan_secure,
--      create_nutrition_plan_secure and the member-initiated branch of
--      create_appointment_secure.
--
-- ORDERING: re-creates functions first defined in patches/015, 018 and 022,
-- so it MUST be applied after all three. Idempotent: every statement is
-- create-or-replace. `create or replace function` keeps each function's OID
-- and its existing GRANTs, so the four re-created operations stay locked to
-- `authenticated` exactly as their original patches left them.

begin;

-- 1. The shared predicate. ---------------------------------------------------
-- ponytail: redeem_checkin_token keeps its own inline CASE -- it needs the
-- granular 'suspended' vs 'expired' string for the scanner message, not a
-- boolean. Deliberate twin, same rule: suspended/expired always fail; an
-- elapsed subscription_until fails even while the status column still says
-- 'active' (nothing sweeps it).
create or replace function public.has_active_subscription(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_member_id
      and p.subscription_status not in ('suspended', 'expired')
      and (p.subscription_until is null or p.subscription_until >= current_date)
  );
$$;

revoke execute on function public.has_active_subscription(uuid) from public, anon;
grant execute on function public.has_active_subscription(uuid) to authenticated;

-- 2. The professional-side status write. ------------------------------------
create or replace function public.set_subscription_status_secure(
  p_member_id uuid, p_status public.subscription_status
) returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.profiles%rowtype;
begin
  if not (public.is_professional() and public.owns_member(p_member_id)) then
    raise exception 'not authorized to manage this membership'
      using errcode = '42501';
  end if;

  -- 'expired' is a system state (an elapsed date), never something the button
  -- sets. The button only ever sends 'active' or 'suspended'.
  if p_status not in ('active', 'suspended') then
    raise exception 'membership status must be active or suspended'
      using errcode = '22023';
  end if;

  update public.profiles p
  set subscription_status = p_status,
      -- Reactivating a lapsed or open-ended-but-past membership grants a fresh
      -- year. Suspending, or reactivating one still in date, leaves it alone.
      subscription_until = case
        when p_status = 'active'
          and (p.subscription_until is null or p.subscription_until < current_date)
        then (current_date + interval '12 months')::date
        else p.subscription_until
      end
  where p.id = p_member_id and p.role = 'member'
  returning * into v_row;

  if not found then
    raise exception 'member not found' using errcode = '42501';
  end if;

  return next v_row;
end;
$$;

revoke execute on function
  public.set_subscription_status_secure(uuid, public.subscription_status)
  from public, anon;
grant execute on function
  public.set_subscription_status_secure(uuid, public.subscription_status)
  to authenticated;

-- 3. close_workout_run_secure -- re-created verbatim from patches/015, with
--    one added guard on the reward insert. ----------------------------------
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

  -- No reward row while the membership is inactive; the run still records
  -- pct / outcome. (patches/023)
  if v_points > 0 and public.has_active_subscription(v_row.member_id) then
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

-- 4. create_workout_plan_secure (8-arg) -- re-created verbatim from
--    patches/018, with one added guard after the authorization check. ------
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

  -- A plan for a lapsed member helps nobody; the member also cannot train
  -- against it (check-in is refused). Applies whoever the author is. (patches/023)
  if not public.has_active_subscription(p_member_id) then
    raise exception 'member subscription is not active' using errcode = '42501';
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

-- 5. create_nutrition_plan_secure (10-arg) -- re-created verbatim from
--    patches/022, with one added guard after the authorization check. -----
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

  -- Same rule as workout plans: no plan for a lapsed member. (patches/023)
  if not public.has_active_subscription(p_member_id) then
    raise exception 'member subscription is not active' using errcode = '42501';
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

-- 6. create_appointment_secure -- re-created verbatim from patches/015, with
--    one added guard on the member-initiated branch. ---------------------
create or replace function public.create_appointment_secure(
  p_id        uuid,
  p_member_id uuid,
  p_pro_id    uuid,
  p_kind      public.appointment_kind,
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_notes     text
) returns setof public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_status public.appointment_status;
  v_row    public.appointments%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'appointment end must be after start'
      using errcode = '22023';
  end if;

  -- Lock in the same member -> professional order used by every operation in
  -- this patch. This prevents an assignment or role change halfway through the
  -- check without introducing opposite lock orders.
  perform 1
  from public.profiles member
  where member.id = p_member_id
    and member.role = 'member'
    and member.assigned_pro_id = p_pro_id
  for share;
  if not found then
    raise exception 'member is not assigned to this professional'
      using errcode = '42501';
  end if;

  perform 1
  from public.profiles pro
  where pro.id = p_pro_id and pro.role = 'professional'
  for share;
  if not found then
    raise exception 'appointment professional is invalid'
      using errcode = '42501';
  end if;

  if v_actor = p_member_id then
    -- A member cannot request a booking while inactive. A professional still
    -- can, on the member's behalf (a comeback session). (patches/023)
    if not public.has_active_subscription(p_member_id) then
      raise exception 'your subscription is not active' using errcode = '42501';
    end if;
    v_status := 'pending';
  elsif v_actor = p_pro_id then
    v_status := 'confirmed';
  else
    raise exception 'caller is not an appointment participant'
      using errcode = '42501';
  end if;

  insert into public.appointments (
    id, member_id, pro_id, kind, status, starts_at, ends_at, notes
  ) values (
    p_id, p_member_id, p_pro_id, p_kind, v_status,
    p_starts_at, p_ends_at, nullif(p_notes, '')
  )
  on conflict (id) do nothing;

  select appointment.* into v_row
  from public.appointments appointment
  where appointment.id = p_id;

  -- An exact retry is success. Reusing an id for different content is not:
  -- silently returning the unrelated row would make the UI report a false
  -- save after an offline replay or an id collision. Status is deliberately
  -- absent: a pending request may already have been confirmed before the
  -- creator's lost-response retry reaches the server.
  if not found
     or v_row.member_id is distinct from p_member_id
     or v_row.pro_id is distinct from p_pro_id
     or v_row.kind is distinct from p_kind
     or v_row.starts_at is distinct from p_starts_at
     or v_row.ends_at is distinct from p_ends_at
     or v_row.notes is distinct from nullif(p_notes, '') then
    raise exception 'appointment id is already used by different content'
      using errcode = '23505';
  end if;

  return next v_row;
end;
$$;

commit;

-- PASS/FAIL ---------------------------------------------------------------------
-- Run after the commit. Every row must read PASS. The two subscription-state
-- rows lean on patches/005-demo-clients.sql having been applied (it seeds one
-- suspended and one expired demo client); without 005 only those two read FAIL.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('has_active_subscription true for an in-date active member',
     (select public.has_active_subscription(id)::text from public.profiles
      where role = 'member' and subscription_status = 'active'
        and (subscription_until is null or subscription_until >= current_date)
      order by id limit 1),
     'true'),
    ('has_active_subscription false for the suspended demo client',
     (select public.has_active_subscription(id)::text from public.profiles
      where role = 'member' and subscription_status = 'suspended'
      order by id limit 1),
     'false'),
    ('has_active_subscription false for the expired demo client',
     (select public.has_active_subscription(id)::text from public.profiles
      where role = 'member' and subscription_status = 'expired'
      order by id limit 1),
     'false'),
    ('set_subscription_status_secure exists with (uuid, subscription_status)',
     (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_subscription_status_secure'
        and pg_get_function_identity_arguments(p.oid)
            = 'p_member_id uuid, p_status subscription_status'),
     '1'),
    ('only authenticated may set membership status',
     has_function_privilege('anon',
       'public.set_subscription_status_secure(uuid, subscription_status)',
       'execute')::text,
     'false'),
    ('the four gated RPCs still exist and stay hardened',
     (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'close_workout_run_secure', 'create_workout_plan_secure',
        'create_nutrition_plan_secure', 'create_appointment_secure')
        and p.prosecdef
        and coalesce(p.proconfig && array['search_path=', 'search_path=""'], false)),
     '4'),
    ('each gated RPC calls has_active_subscription',
     (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'close_workout_run_secure', 'create_workout_plan_secure',
        'create_nutrition_plan_secure', 'create_appointment_secure')
        and pg_get_functiondef(p.oid) like '%has_active_subscription%'),
     '4')
) as t(check_name, actual, expected);
