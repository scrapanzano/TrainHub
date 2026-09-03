-- Patch 015 -- essential security and data-integrity rules.
--
-- Before applying, confirm that nobody is running a workout and that
-- `select count(*) from public.workout_runs where ended_at is null` returns 0.
-- Stop on any SQL error or failed final check; do not rerun blindly. The final
-- query below must report PASS on every row.
--
-- Idempotent: the statements in every completed section are safe to replay.

-- TASK 1: profiles and professional assignment ----------------------------
--
-- A signup is never allowed to choose its own authority. The browser-provided
-- metadata may still provide the display name, but every new profile starts as
-- a member. The privileged demo seed promotes Coach Andrea afterwards.
create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'member'::public.user_role
  );
  return new;
end;
$$;

-- Cross-row rules cannot be expressed by a CHECK constraint because deciding
-- whether assigned_pro_id is valid requires reading a different profile row.
-- This trigger runs as its owner so RLS cannot hide that row while it checks.
create or replace function public.validate_profile_authority() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'professional' and new.assigned_pro_id is not null then
    raise exception 'a professional cannot be assigned to another professional'
      using errcode = '23514';
  end if;

  if new.assigned_pro_id is not null then
    -- The row lock closes a race with a simultaneous demotion. Either the
    -- assignment commits first and makes the demotion fail, or the demotion
    -- commits first and this lookup no longer finds a professional.
    perform 1
    from public.profiles pro
    where pro.id = new.assigned_pro_id
      and pro.role = 'professional'
    for share;

    if not found then
      raise exception 'assigned_pro_id must identify a professional'
        using errcode = '23514';
    end if;
  end if;

  -- Keep existing client assignments valid if an administrator changes a
  -- profile: clear or reassign those clients before demoting their coach.
  if tg_op = 'UPDATE'
     and old.role = 'professional'
     and new.role <> 'professional'
     and exists (
       select 1
       from public.profiles member
       where member.assigned_pro_id = new.id
     ) then
    raise exception 'reassign clients before demoting their professional'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_validate_authority on public.profiles;
create trigger profiles_validate_authority
  before insert or update of role, assigned_pro_id on public.profiles
  for each row execute function public.validate_profile_authority();

-- RLS still limits an UPDATE to the caller's own row. Column privileges are
-- the earlier gate: the browser may edit personal presentation fields and the
-- chosen coach, but never role, specialty or subscription administration.
revoke update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, bio, assigned_pro_id)
  on public.profiles to authenticated;

-- Structural checks for this section are consolidated into the single final
-- table at the end of the patch, because the Supabase editor only displays the
-- result produced by the last statement.

-- TASK 2: appointments, chat, QR access and body metrics ------------------

-- Create one appointment through a checked, replay-safe operation. A member
-- can only request a pending appointment with their assigned professional; a
-- professional can book a confirmed appointment for their assigned client.
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

-- Only the professional named by the row changes status. Exact replays are a
-- no-op, so reconnecting cannot emit a duplicate notification.
create or replace function public.set_appointment_status_secure(
  p_appointment_id uuid,
  p_expected_status public.appointment_status,
  p_status         public.appointment_status
) returns setof public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row   public.appointments%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select appointment.* into v_row
  from public.appointments appointment
  where appointment.id = p_appointment_id
    and appointment.pro_id = v_actor
  for update;

  if not found then
    raise exception 'appointment not found or not managed by caller'
      using errcode = '42501';
  end if;

  perform 1
  from public.profiles pro
  where pro.id = v_actor and pro.role = 'professional'
  for share;
  if not found then
    raise exception 'appointment professional is invalid'
      using errcode = '42501';
  end if;

  if p_status = v_row.status then
    return next v_row;
    return;
  end if;

  if v_row.status is distinct from p_expected_status then
    raise exception 'appointment changed since it was loaded'
      using errcode = '40001';
  end if;

  if not (
    (v_row.status = 'pending' and p_status in ('confirmed', 'cancelled'))
    or (v_row.status = 'confirmed' and p_status in ('done', 'cancelled'))
    or (v_row.status = 'cancelled' and p_status = 'confirmed')
  ) then
    raise exception 'invalid appointment status transition: % to %',
      v_row.status, p_status using errcode = '22023';
  end if;

  update public.appointments
  set status = p_status
  where id = p_appointment_id
  returning * into v_row;

  return next v_row;
end;
$$;

-- Direct writes carried caller-controlled participants and status. Reads stay
-- under RLS; writes now go through the two functions above.
revoke insert, update, delete on public.appointments from anon, authenticated;
drop policy if exists appointments_insert on public.appointments;
drop policy if exists appointments_update on public.appointments;

revoke execute on function public.create_appointment_secure(
  uuid,uuid,uuid,public.appointment_kind,timestamptz,timestamptz,text
) from public, anon;
grant execute on function public.create_appointment_secure(
  uuid,uuid,uuid,public.appointment_kind,timestamptz,timestamptz,text
) to authenticated;

revoke execute on function public.set_appointment_status_secure(
  uuid,public.appointment_status,public.appointment_status
) from public, anon;
grant execute on function public.set_appointment_status_secure(
  uuid,public.appointment_status,public.appointment_status
) to authenticated;

-- Create or return the single thread for the current assigned pair. Both the
-- member and the assigned professional may call it; nobody can choose two
-- unrelated participants.
create or replace function public.ensure_assigned_thread(
  p_member_id uuid,
  p_pro_id    uuid
) returns setof public.threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row   public.threads%rowtype;
begin
  if v_actor is null or v_actor not in (p_member_id, p_pro_id) then
    raise exception 'caller is not a thread participant'
      using errcode = '42501';
  end if;

  perform 1
  from public.profiles member
  where member.id = p_member_id
    and member.role = 'member'
    and member.assigned_pro_id = p_pro_id
  for share;
  if not found then
    raise exception 'thread pair is not the current assignment'
      using errcode = '42501';
  end if;

  perform 1
  from public.profiles pro
  where pro.id = p_pro_id and pro.role = 'professional'
  for share;
  if not found then
    raise exception 'thread professional is invalid'
      using errcode = '42501';
  end if;

  insert into public.threads (member_id, pro_id)
  values (p_member_id, p_pro_id)
  on conflict (member_id, pro_id) do nothing;

  select thread.* into v_row
  from public.threads thread
  where thread.member_id = p_member_id and thread.pro_id = p_pro_id;

  if not found then
    raise exception 'thread could not be created' using errcode = 'P0002';
  end if;

  return next v_row;
end;
$$;

revoke insert, update, delete on public.threads from anon, authenticated;
drop policy if exists threads_insert on public.threads;

revoke execute on function public.ensure_assigned_thread(uuid,uuid)
  from public, anon;
grant execute on function public.ensure_assigned_thread(uuid,uuid)
  to authenticated;

-- A former coaching pair keeps its history in the database but can no longer
-- read or extend it after the assignment changes.
drop policy if exists threads_select on public.threads;
create policy threads_select on public.threads
  for select using (
    (member_id = auth.uid() or pro_id = auth.uid())
    and exists (
      select 1 from public.profiles member
      where member.id = member_id
        and member.role = 'member'
        and member.assigned_pro_id = pro_id
    )
  );

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (
    exists (
      select 1
      from public.threads thread
      join public.profiles member on member.id = thread.member_id
      where thread.id = thread_id
        and (thread.member_id = auth.uid() or thread.pro_id = auth.uid())
        and member.role = 'member'
        and member.assigned_pro_id = thread.pro_id
    )
  );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.threads thread
      join public.profiles member on member.id = thread.member_id
      where thread.id = thread_id
        and (thread.member_id = auth.uid() or thread.pro_id = auth.uid())
        and member.role = 'member'
        and member.assigned_pro_id = thread.pro_id
    )
  );

drop policy if exists messages_update_read on public.messages;
create policy messages_update_read on public.messages
  for update using (
    sender_id <> auth.uid()
    and exists (
      select 1
      from public.threads thread
      join public.profiles member on member.id = thread.member_id
      where thread.id = thread_id
        and (thread.member_id = auth.uid() or thread.pro_id = auth.uid())
        and member.role = 'member'
        and member.assigned_pro_id = thread.pro_id
    )
  ) with check (
    sender_id <> auth.uid()
    and read_at is not null
    and exists (
      select 1
      from public.threads thread
      join public.profiles member on member.id = thread.member_id
      where thread.id = thread_id
        and (thread.member_id = auth.uid() or thread.pro_id = auth.uid())
        and member.role = 'member'
        and member.assigned_pro_id = thread.pro_id
    )
  );

-- Redeem a token only when access is currently valid. A suspended or expired
-- subscription returns its own status without consuming the token and without
-- inserting a check-in; the database expiry still kills the token at 60s.
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

  return query
    select 'ok'::text, v_member.id, v_member.full_name,
           'active'::text, v_member.subscription_until;
end;
$$;

revoke insert, update, delete on public.checkins from anon, authenticated;
drop policy if exists checkins_insert_pro on public.checkins;

revoke execute on function public.redeem_checkin_token(text)
  from public, anon;
grant execute on function public.redeem_checkin_token(text)
  to authenticated;

-- Save one daily measurement. The authenticated professional is stamped by
-- the server. A null field means "not supplied": ON CONFLICT keeps the value
-- already stored instead of erasing it during a later partial save.
create or replace function public.save_body_metric_secure(
  p_member_id  uuid,
  p_measured_on date,
  p_weight_kg  numeric,
  p_note       text
) returns setof public.body_metrics
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note  text := case
    when p_note is null or btrim(p_note) = '' then null
    else p_note
  end;
  v_row public.body_metrics%rowtype;
begin
  if v_actor is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if p_weight_kg is not null and p_weight_kg <= 0 then
    raise exception 'weight must be positive' using errcode = '22023';
  end if;

  if p_weight_kg is null and v_note is null then
    raise exception 'weight or note is required' using errcode = '22023';
  end if;

  perform 1
  from public.profiles member
  where member.id = p_member_id
    and member.role = 'member'
    and member.assigned_pro_id = v_actor
  for share;
  if not found then
    raise exception 'only the assigned professional may save this measurement'
      using errcode = '42501';
  end if;

  perform 1
  from public.profiles pro
  where pro.id = v_actor and pro.role = 'professional'
  for share;
  if not found then
    raise exception 'measurement recorder is not a professional'
      using errcode = '42501';
  end if;

  insert into public.body_metrics as metric (
    member_id, recorded_by_id, measured_on, weight_kg, note
  ) values (
    p_member_id, v_actor, p_measured_on, p_weight_kg, v_note
  )
  on conflict (member_id, measured_on) do update set
    recorded_by_id = excluded.recorded_by_id,
    weight_kg = coalesce(excluded.weight_kg, metric.weight_kg),
    note = coalesce(excluded.note, metric.note)
  returning * into v_row;

  return next v_row;
end;
$$;

revoke insert, update, delete on public.body_metrics from anon, authenticated;
drop policy if exists body_metrics_write_pro on public.body_metrics;

revoke execute on function public.save_body_metric_secure(uuid,date,numeric,text)
  from public, anon;
grant execute on function public.save_body_metric_secure(uuid,date,numeric,text)
  to authenticated;

-- PATCH CHECKS: TASKS 1 AND 2 ----------------------------------------------
-- Every row must read PASS. Authenticated positive/negative behaviour is
-- verified by the probe prepared in Task 4, not by this privileged query.
-- Checks accumulate in a temporary table so the editor's one visible final
-- result contains every section, not just the last task.
drop table if exists pg_temp.patch_015_checks;
create temporary table patch_015_checks (
  check_name text not null,
  actual text,
  expected text not null
);

insert into patch_015_checks (check_name, actual, expected) values
    ('signup function exists',
     (to_regprocedure('public.handle_new_user()') is not null)::text,
     'true'),
    ('signup function has empty search path',
     (select coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false)::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user'),
     'true'),
    ('signup ignores requested role',
     (select (lower(pg_get_functiondef(p.oid)) !~
       'raw_user_meta_data[[:space:]]*->>[[:space:]]*''role''')::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user'),
     'true'),
    ('profile authority function exists',
     (to_regprocedure('public.validate_profile_authority()') is not null)::text,
     'true'),
    ('profile authority function has empty search path',
     (select coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false)::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'validate_profile_authority'),
     'true'),
    ('profile authority trigger attached',
     (select (count(*) = 1)::text
      from pg_trigger
      where tgname = 'profiles_validate_authority' and not tgisinternal),
     'true'),
    ('app can update full_name',
     has_column_privilege(
       'authenticated', 'public.profiles', 'full_name', 'update')::text,
     'true'),
    ('app can update assigned_pro_id',
     has_column_privilege(
       'authenticated', 'public.profiles', 'assigned_pro_id', 'update')::text,
     'true'),
    ('app can update role',
     has_column_privilege(
       'authenticated', 'public.profiles', 'role', 'update')::text,
     'false'),
    ('app can update specialty',
     has_column_privilege(
       'authenticated', 'public.profiles', 'specialty', 'update')::text,
     'false'),
    ('app can update subscription status',
     has_column_privilege(
       'authenticated', 'public.profiles', 'subscription_status', 'update')::text,
     'false'),
    ('app can update subscription expiry',
     has_column_privilege(
       'authenticated', 'public.profiles', 'subscription_until', 'update')::text,
     'false'),
    ('app can update profile id',
     has_column_privilege(
       'authenticated', 'public.profiles', 'id', 'update')::text,
     'false'),
    ('app can update profile created_at',
     has_column_privilege(
       'authenticated', 'public.profiles', 'created_at', 'update')::text,
     'false'),
    ('anonymous can update assigned_pro_id',
     has_column_privilege(
       'anon', 'public.profiles', 'assigned_pro_id', 'update')::text,
     'false'),
    ('four task 2 secure functions exist',
     ((to_regprocedure('public.create_appointment_secure(uuid,uuid,uuid,public.appointment_kind,timestamp with time zone,timestamp with time zone,text)') is not null
       and to_regprocedure('public.set_appointment_status_secure(uuid,public.appointment_status,public.appointment_status)') is not null
       and to_regprocedure('public.ensure_assigned_thread(uuid,uuid)') is not null
       and to_regprocedure('public.save_body_metric_secure(uuid,date,numeric,text)') is not null)::text),
     'true'),
    ('task 2 definer functions have empty search paths',
     (select (count(*) = 5)::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'create_appointment_secure', 'set_appointment_status_secure',
          'ensure_assigned_thread', 'redeem_checkin_token',
          'save_body_metric_secure'
        )
        and p.prosecdef
        and coalesce(
          p.proconfig && array['search_path=', 'search_path=""'], false)),
     'true'),
    ('app cannot insert appointments directly',
     has_table_privilege(
       'authenticated', 'public.appointments', 'insert')::text,
     'false'),
    ('app cannot update appointments directly',
     has_table_privilege(
       'authenticated', 'public.appointments', 'update')::text,
     'false'),
    ('app cannot insert threads directly',
     has_table_privilege(
       'authenticated', 'public.threads', 'insert')::text,
     'false'),
    ('app cannot insert checkins directly',
     has_table_privilege(
       'authenticated', 'public.checkins', 'insert')::text,
     'false'),
    ('app cannot insert body metrics directly',
     has_table_privilege(
       'authenticated', 'public.body_metrics', 'insert')::text,
     'false'),
    ('app cannot update body metrics directly',
     has_table_privilege(
       'authenticated', 'public.body_metrics', 'update')::text,
     'false'),
    ('app can execute appointment creation',
     has_function_privilege(
       'authenticated',
       'public.create_appointment_secure(uuid,uuid,uuid,public.appointment_kind,timestamp with time zone,timestamp with time zone,text)',
       'execute')::text,
     'true'),
    ('app can execute appointment status change',
     has_function_privilege(
       'authenticated',
       'public.set_appointment_status_secure(uuid,public.appointment_status,public.appointment_status)',
       'execute')::text,
     'true'),
    ('anonymous cannot execute appointment creation',
     has_function_privilege(
       'anon',
       'public.create_appointment_secure(uuid,uuid,uuid,public.appointment_kind,timestamp with time zone,timestamp with time zone,text)',
       'execute')::text,
     'false'),
    ('app can execute assigned thread creation',
     has_function_privilege(
       'authenticated', 'public.ensure_assigned_thread(uuid,uuid)', 'execute')::text,
     'true'),
    ('anonymous cannot execute protected task 2 operations',
     ((not has_function_privilege(
         'anon',
         'public.set_appointment_status_secure(uuid,public.appointment_status,public.appointment_status)',
         'execute')
       and not has_function_privilege(
         'anon', 'public.ensure_assigned_thread(uuid,uuid)', 'execute')
       and not has_function_privilege(
         'anon', 'public.save_body_metric_secure(uuid,date,numeric,text)',
         'execute'))::text),
     'true'),
    ('anonymous cannot redeem checkin tokens',
     has_function_privilege(
       'anon', 'public.redeem_checkin_token(text)', 'execute')::text,
     'false'),
    ('app can execute body metric save',
     has_function_privilege(
       'authenticated', 'public.save_body_metric_secure(uuid,date,numeric,text)', 'execute')::text,
     'true'),
    ('legacy direct write policies removed',
     (select (count(*) = 0)::text
      from pg_policies
      where schemaname = 'public'
        and policyname in (
          'appointments_insert', 'appointments_update', 'threads_insert',
          'checkins_insert_pro', 'body_metrics_write_pro'
        )),
     'true'),
    ('message body remains protected',
     has_column_privilege(
       'authenticated', 'public.messages', 'body', 'update')::text,
     'false'),
    ('four notification triggers remain attached',
     (select (count(*) = 4)::text
      from pg_trigger
      where tgname in (
        'on_message_notify', 'on_appointment_status_notify',
        'on_workout_plan_notify', 'on_nutrition_plan_notify'
      ) and not tgisinternal),
     'true');

-- TASK 3: workout plans, runs, sets and rewards ---------------------------

alter table public.workout_plans
  add column if not exists replaces_plan_id uuid;

do $$ begin
  alter table public.workout_plans
    add constraint workout_plans_replaces_fk
    foreign key (replaces_plan_id) references public.workout_plans(id)
    on delete restrict;
exception when duplicate_object then null;
end $$;

create unique index if not exists workout_plans_replaced_once_idx
  on public.workout_plans (replaces_plan_id)
  where replaces_plan_id is not null;

alter table public.rewards add column if not exists run_id uuid;
alter table public.rewards add column if not exists workout_session_id uuid;
alter table public.rewards add column if not exists reward_day date;
do $$ begin
  alter table public.rewards
    add constraint rewards_run_fk foreign key (run_id)
    references public.workout_runs(id) on delete restrict;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.rewards
    add constraint rewards_workout_session_fk foreign key (workout_session_id)
    references public.workout_sessions(id) on delete restrict;
exception when duplicate_object then null;
end $$;
create unique index if not exists rewards_one_per_run_idx
  on public.rewards (run_id) where run_id is not null;
create unique index if not exists rewards_one_workout_per_session_day_idx
  on public.rewards (member_id, workout_session_id, reward_day)
  where workout_session_id is not null and reward_day is not null;

create unique index if not exists set_logs_run_exercise_number_idx
  on public.set_logs (run_id, session_exercise_id, set_number)
  where run_id is not null;

-- Existing rows passed preflight, so these constraints document and enforce
-- the valid numeric domain without inventing a cleanup or backfill.
do $$ begin
  alter table public.workout_plans add constraint workout_plans_weeks_positive
    check (weeks > 0);
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.session_exercises add constraint session_exercises_values_valid
    check (position > 0 and target_sets > 0 and target_reps > 0
      and rest_seconds >= 0 and (target_weight is null or target_weight >= 0));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.set_logs add constraint set_logs_values_valid
    check (set_number > 0 and reps > 0 and (weight is null or weight >= 0));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.workout_runs add constraint workout_runs_values_valid
    check (paused_total_ms >= 0 and (pct is null or pct between 0 and 100)
      and (ended_at is null or ended_at >= started_at));
exception when duplicate_object then null;
end $$;

-- Defence below the RPC layer: even a future privileged writer cannot attach
-- a run or set to a different member/session chain by mistake.
create or replace function public.validate_workout_run_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.workout_sessions session
    join public.workout_plans plan on plan.id = session.plan_id
    where session.id = new.session_id and plan.member_id = new.member_id
  ) then
    raise exception 'run member does not own the session plan'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_runs_validate_chain on public.workout_runs;
create trigger workout_runs_validate_chain
  before insert or update of session_id, member_id on public.workout_runs
  for each row execute function public.validate_workout_run_chain();

create or replace function public.validate_set_log_chain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.run_id is null then
    if tg_op = 'INSERT' then
      raise exception 'new set logs require a workout run'
        using errcode = '23514';
    end if;
    if old.run_id is not null then
      raise exception 'new set logs require a workout run'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.workout_runs run
    join public.session_exercises item on item.id = new.session_exercise_id
    where run.id = new.run_id
      and run.member_id = new.member_id
      and run.session_id = item.session_id
  ) then
    raise exception 'set log does not belong to its run and session'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists set_logs_validate_chain on public.set_logs;
create trigger set_logs_validate_chain
  before insert or update of run_id, session_exercise_id, member_id
  on public.set_logs
  for each row execute function public.validate_set_log_chain();

-- Internal atomic session bundle. EXECUTE is revoked from browser roles below;
-- only the two checked plan/session operations call it.
create or replace function public._insert_session_bundle(
  p_session_id uuid,
  p_plan_id uuid,
  p_name text,
  p_position int,
  p_exercises jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  if p_position <= 0 or jsonb_typeof(p_exercises) <> 'array'
     or jsonb_array_length(p_exercises) = 0 then
    raise exception 'a session needs a positive position and exercises'
      using errcode = '22023';
  end if;

  insert into public.workout_sessions (id, plan_id, name, position)
  values (p_session_id, p_plan_id, p_name, p_position);

  insert into public.session_exercises (
    id, session_id, exercise_id, position, target_sets, target_reps,
    target_weight, rest_seconds, notes
  )
  select item.id, p_session_id, item.exercise_id, item.position,
         item.target_sets, item.target_reps, item.target_weight,
         coalesce(item.rest_seconds, 90), item.notes
  from jsonb_to_recordset(p_exercises) as item(
    id uuid, exercise_id uuid, position int, target_sets int,
    target_reps int, target_weight numeric, rest_seconds int, notes text
  );

  if not found then
    raise exception 'a session needs at least one valid exercise'
      using errcode = '22023';
  end if;
  return p_session_id;
end;
$$;

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
  where member.id = p_member_id and member.role = 'member'
    and member.assigned_pro_id = v_actor for update;
  if not found or not public.is_professional() then
    raise exception 'only the assigned professional may create this plan'
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

create or replace function public.create_workout_session_secure(
  p_session_id uuid, p_plan_id uuid, p_name text, p_position int,
  p_exercises jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_member uuid;
  v_existing public.workout_sessions%rowtype;
begin
  select plan.member_id into v_member from public.workout_plans plan
  where plan.id = p_plan_id and plan.author_id = v_actor for share;
  if not found then
    raise exception 'only the plan author may add a session'
      using errcode = '42501';
  end if;
  perform 1 from public.profiles member
  where member.id = v_member and member.role = 'member'
    and member.assigned_pro_id = v_actor
  for share;
  if not found then
    raise exception 'client is no longer assigned to the plan author'
      using errcode = '42501';
  end if;

  select session.* into v_existing from public.workout_sessions session
  where session.id = p_session_id;
  if found then
    if v_existing.plan_id is distinct from p_plan_id
       or v_existing.name is distinct from p_name
       or v_existing.position is distinct from p_position then
      raise exception 'session id is already used by different content'
        using errcode = '23505';
    end if;
    return p_session_id;
  end if;
  return public._insert_session_bundle(
    p_session_id, p_plan_id, p_name, p_position, p_exercises);
end;
$$;

create or replace function public.add_session_exercise_secure(
  p_id uuid, p_session_id uuid, p_exercise_id uuid, p_position int,
  p_target_sets int, p_target_reps int, p_target_weight numeric,
  p_rest_seconds int
) returns setof public.session_exercises
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_member uuid;
  v_row public.session_exercises%rowtype;
begin
  select plan.member_id into v_member
  from public.workout_sessions session
  join public.workout_plans plan on plan.id = session.plan_id
  where session.id = p_session_id and plan.author_id = v_actor
  for update of session;
  if not found then
    raise exception 'only the plan author may add an exercise'
      using errcode = '42501';
  end if;

  perform 1 from public.profiles member
  where member.id = v_member and member.role = 'member'
    and member.assigned_pro_id = v_actor
  for share;
  if not found then
    raise exception 'client is no longer assigned to the plan author'
      using errcode = '42501';
  end if;

  -- Changing a session that already has history would also change what its old
  -- summaries appear to mean. DATA-003 records the missing full prescription
  -- snapshot, so this small-project rule protects the history that does exist.
  if exists (select 1 from public.workout_runs run
             where run.session_id = p_session_id) then
    raise exception 'a session with workout history cannot be changed'
      using errcode = '23514';
  end if;

  select item.* into v_row from public.session_exercises item
  where item.id = p_id;
  if found then
    if v_row.session_id is distinct from p_session_id
       or v_row.exercise_id is distinct from p_exercise_id
       or v_row.position is distinct from p_position
       or v_row.target_sets is distinct from p_target_sets
       or v_row.target_reps is distinct from p_target_reps
       or v_row.target_weight is distinct from p_target_weight
       or v_row.rest_seconds is distinct from p_rest_seconds then
      raise exception 'exercise id is already used by different content'
        using errcode = '23505';
    end if;
    return next v_row;
    return;
  end if;

  insert into public.session_exercises (
    id, session_id, exercise_id, position, target_sets, target_reps,
    target_weight, rest_seconds
  ) values (
    p_id, p_session_id, p_exercise_id, p_position, p_target_sets,
    p_target_reps, p_target_weight, p_rest_seconds
  ) returning * into v_row;
  return next v_row;
end;
$$;

create or replace function public.start_workout_run_secure(
  p_run_id uuid, p_session_id uuid, p_started_at timestamptz
) returns setof public.workout_runs
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_row public.workout_runs%rowtype;
begin
  if not exists (
    select 1 from public.workout_sessions session
    join public.workout_plans plan on plan.id = session.plan_id
    where session.id = p_session_id and plan.member_id = v_actor
    for share of session
  ) then raise exception 'session does not belong to caller' using errcode = '42501';
  end if;

  insert into public.workout_runs (id, session_id, member_id, started_at)
  values (p_run_id, p_session_id, v_actor, p_started_at)
  on conflict (id) do nothing;
  select run.* into v_row from public.workout_runs run where run.id = p_run_id;
  if v_row.member_id is distinct from v_actor
     or v_row.session_id is distinct from p_session_id
     or v_row.started_at is distinct from p_started_at then
    raise exception 'run id is already used by different content' using errcode = '23505';
  end if;
  return next v_row;
end;
$$;

create or replace function public.pause_workout_run_secure(
  p_run_id uuid, p_expected_paused_total_ms int, p_paused_at timestamptz
) returns setof public.workout_runs
language plpgsql security definer set search_path = '' as $$
declare v_row public.workout_runs%rowtype;
begin
  select run.* into v_row from public.workout_runs run
  where run.id = p_run_id and run.member_id = auth.uid() for update;
  if not found or v_row.ended_at is not null then
    raise exception 'open run not found' using errcode = '42501';
  end if;
  if p_paused_at is null or p_paused_at < v_row.started_at then
    raise exception 'pause time is invalid' using errcode = '22023';
  end if;
  if p_expected_paused_total_ms is null
     or v_row.paused_total_ms is distinct from p_expected_paused_total_ms then
    raise exception 'run changed before pause arrived' using errcode = '40001';
  end if;
  if v_row.paused_at is null then
    update public.workout_runs set paused_at = p_paused_at where id = p_run_id
    returning * into v_row;
  elsif v_row.paused_at is distinct from p_paused_at then
    raise exception 'run is already paused at a different time' using errcode = '40001';
  end if;
  return next v_row;
end;
$$;

create or replace function public.resume_workout_run_secure(
  p_run_id uuid, p_expected_paused_at timestamptz, p_resumed_at timestamptz
) returns setof public.workout_runs
language plpgsql security definer set search_path = '' as $$
declare v_row public.workout_runs%rowtype; v_extra bigint;
begin
  select run.* into v_row from public.workout_runs run
  where run.id = p_run_id and run.member_id = auth.uid() for update;
  if not found or v_row.ended_at is not null then
    raise exception 'open run not found' using errcode = '42501';
  end if;
  if v_row.paused_at is null then return next v_row; return; end if;
  if v_row.paused_at is distinct from p_expected_paused_at then
    raise exception 'run pause changed before resume arrived' using errcode = '40001';
  end if;
  if p_resumed_at < v_row.paused_at then
    raise exception 'resume time precedes pause time' using errcode = '22023';
  end if;
  v_extra := floor(extract(epoch from (p_resumed_at - v_row.paused_at)) * 1000);
  update public.workout_runs set paused_at = null,
    paused_total_ms = paused_total_ms + v_extra
  where id = p_run_id returning * into v_row;
  return next v_row;
end;
$$;

create or replace function public.log_workout_set_secure(
  p_id uuid, p_run_id uuid, p_session_exercise_id uuid,
  p_set_number int, p_reps int, p_weight numeric, p_performed_at timestamptz
) returns setof public.set_logs
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_row public.set_logs%rowtype;
begin
  perform 1
    from public.workout_runs run
    join public.session_exercises item on item.id = p_session_exercise_id
    where run.id = p_run_id and run.member_id = v_actor
      and run.ended_at is null and run.session_id = item.session_id
    for share of run;
  if not found then
    raise exception 'set does not belong to an open caller run' using errcode = '42501';
  end if;
  insert into public.set_logs (
    id, run_id, session_exercise_id, member_id, set_number, reps, weight, performed_at
  ) values (
    p_id, p_run_id, p_session_exercise_id, v_actor,
    p_set_number, p_reps, p_weight, p_performed_at
  ) on conflict (id) do nothing;
  select log.* into v_row from public.set_logs log where log.id = p_id;
  if v_row.run_id is distinct from p_run_id
     or v_row.session_exercise_id is distinct from p_session_exercise_id
     or v_row.member_id is distinct from v_actor
     or v_row.set_number is distinct from p_set_number
     or v_row.reps is distinct from p_reps
     or v_row.weight is distinct from p_weight
     or v_row.performed_at is distinct from p_performed_at then
    raise exception 'set id is already used by different content' using errcode = '23505';
  end if;
  return next v_row;
end;
$$;

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
  select coalesce(sum(least(coalesce(logged.amount, 0), item.target_sets)), 0)
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

create or replace function public.save_workout_run_note_secure(
  p_run_id uuid, p_note text
) returns setof public.workout_runs
language plpgsql security definer set search_path = '' as $$
declare v_row public.workout_runs%rowtype;
begin
  update public.workout_runs set note = nullif(p_note, '')
  where id = p_run_id and member_id = auth.uid() and ended_at is not null
  returning * into v_row;
  if not found then raise exception 'closed caller run not found' using errcode = '42501'; end if;
  return next v_row;
end;
$$;

-- Reads remain; every sensitive workout write now uses the operations above.
revoke insert, update, delete on public.workout_plans,
  public.workout_sessions, public.session_exercises,
  public.workout_runs, public.set_logs, public.rewards
  from anon, authenticated;
drop policy if exists workout_plans_write on public.workout_plans;
drop policy if exists workout_sessions_all on public.workout_sessions;
drop policy if exists session_exercises_all on public.session_exercises;
drop policy if exists workout_runs_write_self on public.workout_runs;
drop policy if exists set_logs_write_self on public.set_logs;
drop policy if exists rewards_insert_self on public.rewards;
drop trigger if exists rewards_set_points on public.rewards;

-- The old session policies were FOR ALL. Replacing them with SELECT policies
-- keeps plans readable while all writes move behind the checked operations.
drop policy if exists workout_sessions_select on public.workout_sessions;
create policy workout_sessions_select on public.workout_sessions
  for select using (
    exists (select 1 from public.workout_plans plan
            where plan.id = plan_id and public.owns_member(plan.member_id))
  );

drop policy if exists session_exercises_select on public.session_exercises;
create policy session_exercises_select on public.session_exercises
  for select using (
    exists (
      select 1
      from public.workout_sessions session
      join public.workout_plans plan on plan.id = session.plan_id
      where session.id = session_id and public.owns_member(plan.member_id)
    )
  );

revoke execute on function public._insert_session_bundle(uuid,uuid,text,int,jsonb)
  from public, anon, authenticated;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_workout_plan_secure', 'create_workout_session_secure',
      'add_session_exercise_secure', 'start_workout_run_secure',
      'pause_workout_run_secure',
      'resume_workout_run_secure', 'log_workout_set_secure',
      'close_workout_run_secure', 'save_workout_run_note_secure'
    )
  loop
    execute format('revoke execute on function %s from public, anon', r.signature);
    execute format('grant execute on function %s to authenticated', r.signature);
  end loop;
end $$;

-- TASK 3 CHECKS ------------------------------------------------------------
insert into patch_015_checks (check_name, actual, expected) values
  ('workout predecessor column exists',
   (select (count(*) = 1)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'workout_plans'
      and column_name = 'replaces_plan_id'), 'true'),
  ('reward run link exists',
   (select (count(*) = 1)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'rewards'
      and column_name = 'run_id'), 'true'),
  ('set number is unique inside one run exercise',
   (select (count(*) = 1)::text from pg_indexes
    where schemaname = 'public' and tablename = 'set_logs'
      and indexname = 'set_logs_run_exercise_number_idx'
      and indexdef ilike '%unique%'), 'true'),
  ('one workout reward per session and day',
   (select (count(*) = 1)::text from pg_indexes
    where schemaname = 'public' and tablename = 'rewards'
      and indexname = 'rewards_one_workout_per_session_day_idx'
      and indexdef ilike '%unique%'), 'true'),
  ('workout chain triggers attached',
   (select (count(*) = 2)::text from pg_trigger
    where tgname in ('workout_runs_validate_chain','set_logs_validate_chain')
      and not tgisinternal), 'true'),
  ('session read policies preserved',
   (select (count(*) = 2)::text from pg_policies
    where schemaname = 'public'
      and ((tablename = 'workout_sessions' and policyname = 'workout_sessions_select')
        or (tablename = 'session_exercises' and policyname = 'session_exercises_select'))
      and cmd = 'SELECT'), 'true'),
  ('nine workout operations exist',
   (select (count(*) = 9)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_workout_plan_secure','create_workout_session_secure',
      'add_session_exercise_secure','start_workout_run_secure',
      'pause_workout_run_secure',
      'resume_workout_run_secure','log_workout_set_secure',
      'close_workout_run_secure','save_workout_run_note_secure')), 'true'),
  ('all workout operations have empty search paths',
   (select (count(*) = 9)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'create_workout_plan_secure','create_workout_session_secure',
      'add_session_exercise_secure','start_workout_run_secure',
      'pause_workout_run_secure','resume_workout_run_secure',
      'log_workout_set_secure','close_workout_run_secure',
      'save_workout_run_note_secure')
      and p.prosecdef and coalesce(p.proconfig && array['search_path=','search_path=""'],false)), 'true'),
  ('app can call all workout operations',
   (select (count(*) = 9)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_workout_plan_secure','create_workout_session_secure',
      'add_session_exercise_secure','start_workout_run_secure',
      'pause_workout_run_secure','resume_workout_run_secure',
      'log_workout_set_secure','close_workout_run_secure',
      'save_workout_run_note_secure')
      and has_function_privilege('authenticated', p.oid, 'execute')), 'true'),
  ('anonymous caller cannot call workout operations',
   (select (count(*) = 0)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_workout_plan_secure','create_workout_session_secure',
      'add_session_exercise_secure','start_workout_run_secure',
      'pause_workout_run_secure','resume_workout_run_secure',
      'log_workout_set_secure','close_workout_run_secure',
      'save_workout_run_note_secure')
      and has_function_privilege('anon', p.oid, 'execute')), 'true'),
  ('internal session helper is not callable by the app',
   has_function_privilege('authenticated',
     'public._insert_session_bundle(uuid,uuid,text,integer,jsonb)',
     'execute')::text, 'false'),
  ('app cannot directly insert plans',
   has_table_privilege('authenticated','public.workout_plans','insert')::text, 'false'),
  ('app cannot directly update plans',
   has_table_privilege('authenticated','public.workout_plans','update')::text, 'false'),
  ('app cannot directly delete sessions',
   has_table_privilege('authenticated','public.workout_sessions','delete')::text, 'false'),
  ('app cannot directly insert sets',
   has_table_privilege('authenticated','public.set_logs','insert')::text, 'false'),
  ('app cannot directly insert prescribed exercises',
   has_table_privilege('authenticated','public.session_exercises','insert')::text, 'false'),
  ('app cannot directly update runs',
   has_table_privilege('authenticated','public.workout_runs','update')::text, 'false'),
  ('app cannot directly insert rewards',
   has_table_privilege('authenticated','public.rewards','insert')::text, 'false'),
  ('app can read workout sessions',
   has_table_privilege('authenticated','public.workout_sessions','select')::text, 'true'),
  ('app can read prescribed exercises',
   has_table_privilege('authenticated','public.session_exercises','select')::text, 'true'),
  ('legacy reward points trigger removed',
   (select (count(*) = 0)::text from pg_trigger
    where tgname='rewards_set_points' and not tgisinternal), 'true');

-- FINAL CROSS-CUTTING CHECKS -----------------------------------------------
-- These deliberately repeat the high-level counts. A task can be correct on
-- its own while the combined patch accidentally removes a read policy, grant
-- or hardening setting used by another task.
insert into patch_015_checks (check_name, actual, expected) values
  ('all 19 public tables still exist',
   (select count(*)::text from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'), '19'),
  ('all 19 public tables have RLS',
   (select count(*)::text from pg_tables
    where schemaname = 'public' and rowsecurity), '19'),
  ('18 application tables have policies',
   (select count(distinct tablename)::text from pg_policies
    where schemaname = 'public'), '18'),
  ('app_config remains policy-less',
   (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename = 'app_config'), '0'),
  ('app can read 18 application tables',
   (select count(*)::text from pg_tables
    where schemaname = 'public'
      and has_table_privilege(
        'authenticated', format('%I.%I', schemaname, tablename), 'select')), '18'),
  ('app retains direct insert on only 8 tables',
   (select count(*)::text from pg_tables
    where schemaname = 'public'
      and has_table_privilege(
        'authenticated', format('%I.%I', schemaname, tablename), 'insert')), '8'),
  ('no unsafe public security-definer search path',
   (select count(*)::text from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false)), '0'),
  ('notification secret remains unreadable',
   has_table_privilege('authenticated', 'public.app_config', 'select')::text, 'false'),
  ('notification endpoint remains uncallable from browser',
   ((not has_function_privilege(
       'authenticated', 'public.notify_user(uuid,text,text,text,text)', 'execute')
     and not has_function_privilege(
       'anon', 'public.notify_user(uuid,text,text,text,text)', 'execute'))::text), 'true'),
  ('messages remain in Realtime publication',
   (select (count(*) = 1)::text from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'messages'), 'true');

-- This must remain the final statement. Supabase displays only its result.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_015_checks
order by check_name;
