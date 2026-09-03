-- Patch 021 -- correct the appointment push's timezone, and let a caller
-- manage their own notification list (delete, bulk actions, clear all).
--
-- notify_on_appointment_status() formatted `starts_at` (timestamptz, stored
-- UTC) in the trigger's default session timezone rather than Europe/Rome,
-- so a 10:12 local appointment read 8:00 in the push -- the exact 2-hour
-- CEST offset. Fixed the same way patches/016 fixed `reward_day`.
--
-- The five new RPCs mirror the two in patches/020 (single-id vs bulk vs
-- everything), each `security definer`, scoped to auth.uid(), no direct
-- table write grant to the browser.
--
-- Idempotent: safe to replay.

begin;

-- Put `notifications` on the Realtime publication, or `AppLayout.jsx`'s
-- subscription connects, reports SUBSCRIBED, and never fires -- the exact
-- failure mode `patches/007` already documented for `messages`.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

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
    to_char(new.starts_at at time zone 'Europe/Rome', 'Dy DD Mon at HH24:MI'),
    '/m/trainer/appointments',
    'appointment');
  return null;
exception when others then
  raise warning 'notify_on_appointment_status failed: %', sqlerrm;
  return null;
end $$;

create or replace function public.delete_notification_secure(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where id = p_id and user_id = auth.uid();
end $$;

revoke execute on function public.delete_notification_secure(uuid)
  from public, anon;
grant execute on function public.delete_notification_secure(uuid)
  to authenticated;

create or replace function public.mark_notifications_read_by_ids_secure(p_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and id = any(p_ids) and read_at is null;
end $$;

revoke execute on function public.mark_notifications_read_by_ids_secure(uuid[])
  from public, anon;
grant execute on function public.mark_notifications_read_by_ids_secure(uuid[])
  to authenticated;

create or replace function public.delete_notifications_by_ids_secure(p_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where user_id = auth.uid() and id = any(p_ids);
end $$;

revoke execute on function public.delete_notifications_by_ids_secure(uuid[])
  from public, anon;
grant execute on function public.delete_notifications_by_ids_secure(uuid[])
  to authenticated;

create or replace function public.mark_all_notifications_read_secure(p_before timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null and created_at <= p_before;
end $$;

revoke execute on function public.mark_all_notifications_read_secure(timestamptz)
  from public, anon;
grant execute on function public.mark_all_notifications_read_secure(timestamptz)
  to authenticated;

create or replace function public.delete_all_notifications_secure(p_before timestamptz)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where user_id = auth.uid() and created_at <= p_before;
end $$;

revoke execute on function public.delete_all_notifications_secure(timestamptz)
  from public, anon;
grant execute on function public.delete_all_notifications_secure(timestamptz)
  to authenticated;

drop table if exists pg_temp.patch_021_checks;
create temporary table patch_021_checks (
  check_name text not null, actual text, expected text not null
) on commit preserve rows;

insert into patch_021_checks (check_name, actual, expected) values
  ('notifications are in the Realtime publication',
   (select (count(*) = 1)::text from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'notifications'),
   'true'),
  ('appointment push formats in Europe/Rome',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%attimezone''europe/rome''%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_on_appointment_status'),
   'true'),
  ('authenticated caller can delete one notification',
   has_function_privilege('authenticated',
     'public.delete_notification_secure(uuid)', 'execute')::text,
   'true'),
  ('authenticated caller can mark a selection read',
   has_function_privilege('authenticated',
     'public.mark_notifications_read_by_ids_secure(uuid[])', 'execute')::text,
   'true'),
  ('authenticated caller can delete a selection',
   has_function_privilege('authenticated',
     'public.delete_notifications_by_ids_secure(uuid[])', 'execute')::text,
   'true'),
  ('authenticated caller can mark everything read',
   has_function_privilege('authenticated',
     'public.mark_all_notifications_read_secure(timestamptz)', 'execute')::text,
   'true'),
  ('authenticated caller can delete everything',
   has_function_privilege('authenticated',
     'public.delete_all_notifications_secure(timestamptz)', 'execute')::text,
   'true'),
  ('anonymous caller cannot manage notifications',
   (not has_function_privilege('anon',
      'public.delete_notification_secure(uuid)', 'execute')
    and not has_function_privilege('anon',
      'public.mark_notifications_read_by_ids_secure(uuid[])', 'execute')
    and not has_function_privilege('anon',
      'public.delete_notifications_by_ids_secure(uuid[])', 'execute')
    and not has_function_privilege('anon',
      'public.mark_all_notifications_read_secure(timestamptz)', 'execute')
    and not has_function_privilege('anon',
      'public.delete_all_notifications_secure(timestamptz)', 'execute'))::text,
   'true');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_021_checks
order by check_name;
