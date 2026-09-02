-- Patch 020 -- a real notification center.
--
-- notify_user() (patches/010) only ever fired an external Web Push; nothing
-- was ever persisted, so there was nothing to list, mark read, or reconcile
-- against a tapped OS notification. This patch adds that persistence: every
-- call to notify_user() now also writes a row here, and two new RPCs let the
-- signed-in caller mark their own rows read -- one at a time (tapping a row
-- in the list) or by URL (visiting the page a notification points at,
-- however they got there).
--
-- notify_user()'s signature grows by one argument (p_type), which is a
-- DIFFERENT overload as far as Postgres is concerned -- the old 4-argument
-- version is dropped explicitly first, same lesson patch 018 already
-- documented, or it would linger alongside the new one.
--
-- Idempotent: safe to replay.

begin;

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  url        text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- Postgres checks the table GRANT before it evaluates any policy -- the
-- grant is the gate that actually runs first (patches/006).
grant select on public.notifications to authenticated;
revoke insert, update, delete on public.notifications from authenticated, anon;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

drop function if exists public.notify_user(uuid, text, text, text);

create or replace function public.notify_user(
  p_user  uuid,
  p_title text,
  p_body  text,
  p_url   text,
  p_type  text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  insert into public.notifications (user_id, type, title, body, url)
  values (p_user, p_type, p_title, p_body, p_url);

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

revoke execute on function public.notify_user(uuid,text,text,text,text)
  from public, anon, authenticated;

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
    end,
    'message');
  return null;
exception when others then
  raise warning 'notify_on_message failed: %', sqlerrm;
  return null;
end $$;

-- 2. An appointment reaching 'confirmed', 'cancelled' or 'done' notifies the member.
create or replace function notify_on_appointment_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  -- 'pending' is not news to anyone yet -- only a row that reaches
  -- 'confirmed', 'cancelled' or 'done' is.
  if new.status = 'pending' then
    return null;
  end if;

  perform public.notify_user(
    new.member_id,
    'Appointment ' || new.status,
    to_char(new.starts_at, 'Dy DD Mon at HH24:MI'),
    '/m/trainer/appointments',
    'appointment');
  return null;
exception when others then
  raise warning 'notify_on_appointment_status failed: %', sqlerrm;
  return null;
end $$;

-- 3 and 4. A newly assigned plan notifies the member. Two tables, one event,
-- and the copy names which kind arrived.
create or replace function notify_on_workout_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_user(new.member_id, 'New workout plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/workout',
                      'workout_plan');
  return null;
exception when others then
  raise warning 'notify_on_workout_plan failed: %', sqlerrm;
  return null;
end $$;

create or replace function notify_on_nutrition_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_user(new.member_id, 'New nutrition plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/nutrition',
                      'nutrition_plan');
  return null;
exception when others then
  raise warning 'notify_on_nutrition_plan failed: %', sqlerrm;
  return null;
end $$;

-- The four triggers already exist (patches/010) and already point at these
-- function names -- redefining the functions is enough, no trigger DDL to
-- replay here.

create or replace function public.mark_notification_read_secure(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where id = p_id and user_id = auth.uid() and read_at is null;
end $$;

revoke execute on function public.mark_notification_read_secure(uuid)
  from public, anon;
grant execute on function public.mark_notification_read_secure(uuid)
  to authenticated;

create or replace function public.mark_notifications_read_secure(p_url text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and url = p_url and read_at is null;
end $$;

revoke execute on function public.mark_notifications_read_secure(text)
  from public, anon;
grant execute on function public.mark_notifications_read_secure(text)
  to authenticated;

drop table if exists pg_temp.patch_020_checks;
create temporary table patch_020_checks (
  check_name text not null, actual text, expected text not null
) on commit preserve rows;

insert into patch_020_checks (check_name, actual, expected) values
  ('notifications table exists',
   (select (count(*) = 1)::text from information_schema.tables
    where table_schema = 'public' and table_name = 'notifications'),
   'true'),
  ('the app role cannot write notifications directly',
   (not (has_table_privilege('authenticated', 'public.notifications', 'insert')
      or has_table_privilege('authenticated', 'public.notifications', 'update')
      or has_table_privilege('authenticated', 'public.notifications', 'delete')))::text,
   'true'),
  ('the app role can only read its own notifications',
   (select (count(*) = 1)::text from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'notifications_select'),
   'true'),
  ('the old notify_user overload is gone',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_user'),
   '1'),
  ('notify_user persists before it pushes',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%insertintopublic.notifications%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_user'),
   'true'),
  ('notify_user stays unreachable from the browser',
   (not has_function_privilege('authenticated',
      'public.notify_user(uuid,text,text,text,text)', 'execute')
    and not has_function_privilege('anon',
      'public.notify_user(uuid,text,text,text,text)', 'execute'))::text,
   'true'),
  ('authenticated caller can mark one notification read',
   has_function_privilege('authenticated',
     'public.mark_notification_read_secure(uuid)', 'execute')::text,
   'true'),
  ('authenticated caller can mark notifications read by url',
   has_function_privilege('authenticated',
     'public.mark_notifications_read_secure(text)', 'execute')::text,
   'true'),
  ('anonymous caller cannot mark anything read',
   (not has_function_privilege('anon',
      'public.mark_notification_read_secure(uuid)', 'execute')
    and not has_function_privilege('anon',
      'public.mark_notifications_read_secure(text)', 'execute'))::text,
   'true');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_020_checks
order by check_name;
