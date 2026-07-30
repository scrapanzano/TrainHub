-- Push notifications, database half.
--
-- The notification is raised HERE rather than by the sender's client for two
-- reasons: a client-side call cannot fire for a message written offline and
-- replayed after the app was closed, and anyone holding the publishable key --
-- which ships in the JS bundle -- could forge one for another user.
--
-- `net.http_post` is ASYNCHRONOUS: it queues the request and returns an id, so
-- inserting a message never waits on an HTTP call and cannot fail because of
-- one.  The exception handler is there anyway: a lost notification is an
-- annoyance, a lost message is a bug.
--
-- Idempotent: guarded throughout.

create extension if not exists pg_net;

-- Configuration the database needs and nobody else may read.
--
-- RLS is enabled with NO policies, which denies every PostgREST caller, and the
-- grants are revoked as well -- Postgres checks the grant before the policy, so
-- that is the gate that actually runs first.  Only notify_user(), which is
-- `security definer` and owned by the superuser, reads this table.
create table if not exists app_config (
  key   text primary key,
  value text not null
);

alter table app_config enable row level security;
revoke all on table app_config from anon, authenticated;

-- Send one notification.  Never raises into its caller.
--
-- `search_path = ''` with fully qualified names, here and in every trigger
-- function below, is a security boundary rather than a style: Postgres resolves
-- an unqualified RELATION through the temporary schema first, and any signed-in
-- role may create temp tables.  A `security definer` function reading an
-- unqualified `app_config` could therefore be handed a forged one -- and this
-- particular table holds the secret that authenticates the database to the Edge
-- Function.  `now()` and the other built-ins need no qualification: pg_catalog
-- is searched first whatever `search_path` says.
create or replace function notify_user(
  p_user  uuid,
  p_title text,
  p_body  text,
  p_url   text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from public.app_config where key = 'notify_function_url';
  select value into v_secret from public.app_config where key = 'notify_secret';

  -- Unconfigured is not an error: the badge and the scanner must keep working
  -- on a database where the Edge Function was never deployed.
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-notify-secret', v_secret),
    body    := jsonb_build_object(
                 'user_id', p_user,
                 'title',   p_title,
                 'body',    p_body,
                 'url',     p_url)
  );
exception when others then
  raise warning 'notify_user failed for %: %', p_user, sqlerrm;
end $$;

-- 1. A new chat message notifies the OTHER party.
create or replace function notify_on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_target uuid;
  v_sender text;
begin
  select case when t.member_id = new.sender_id then t.pro_id else t.member_id end
  into v_target
  from public.threads t where t.id = new.thread_id;

  select full_name into v_sender from public.profiles where id = new.sender_id;

  perform public.notify_user(
    v_target,
    coalesce(v_sender, 'New message'),
    left(new.body, 120),
    case when v_target = (select member_id from public.threads where id = new.thread_id)
         then '/m/trainer/chat'
         else '/p/chat/' || new.thread_id::text
    end);
  return null;
end $$;

drop trigger if exists on_message_notify on messages;
create trigger on_message_notify
  after insert on messages
  for each row execute function notify_on_message();

-- 2. A change of appointment status notifies the member.
create or replace function notify_on_appointment_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  perform public.notify_user(
    new.member_id,
    'Appointment ' || new.status,
    to_char(new.starts_at, 'Dy DD Mon at HH24:MI'),
    '/m/trainer/appointments');
  return null;
end $$;

drop trigger if exists on_appointment_status_notify on appointments;
create trigger on_appointment_status_notify
  after update of status on appointments
  for each row execute function notify_on_appointment_status();

-- 3 and 4. A newly assigned plan notifies the member.  Two tables, one event,
-- and the copy names which kind arrived.
create or replace function notify_on_workout_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_user(new.member_id, 'New workout plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/workout');
  return null;
end $$;

drop trigger if exists on_workout_plan_notify on workout_plans;
create trigger on_workout_plan_notify
  after insert on workout_plans
  for each row execute function notify_on_workout_plan();

create or replace function notify_on_nutrition_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_user(new.member_id, 'New nutrition plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/nutrition');
  return null;
end $$;

drop trigger if exists on_nutrition_plan_notify on nutrition_plans;
create trigger on_nutrition_plan_notify
  after insert on nutrition_plans
  for each row execute function notify_on_nutrition_plan();

-- Every row must read PASS.
--
-- `config unreadable by the app role` is the one that matters: if it reads
-- FAIL, the shared secret that authenticates the database to the Edge Function
-- is readable by anyone holding the publishable key.
select 'pg_net installed' as check,
  (select count(*) = 1 from pg_extension where extname = 'pg_net') as ok
union all
select 'notify_user exists',
  (to_regprocedure('public.notify_user(uuid,text,text,text)') is not null)
union all
select 'four triggers',
  (select count(*) = 4 from pg_trigger
   where tgname in ('on_message_notify', 'on_appointment_status_notify',
                    'on_workout_plan_notify', 'on_nutrition_plan_notify'))
union all
select 'config unreadable by the app role',
  (not has_table_privilege('authenticated', 'public.app_config', 'select'));
