-- Patch 012 -- notify the member when a professional books an appointment
-- directly, not only when they confirm one the member requested.
--
-- WHAT WENT WRONG
--
-- patches/010 wired `notify_on_appointment_status()` to
-- `after update of status on appointments`. That covers the member-request
-- path: `BookingSheet.jsx` INSERTs at status 'pending', the professional later
-- UPDATEs that row's status, and the UPDATE trigger fires.
--
-- But `NewAppointmentSheet.jsx` -- the professional's own "new appointment"
-- control, reached from the agenda -- calls the same `createAppointment` with
-- no `status` argument, which defaults to 'confirmed' (the professional owns
-- the diary; there is no pending step for their own booking). That row is
-- INSERTed already at 'confirmed'. No UPDATE ever touches its status column,
-- so the UPDATE-only trigger never fired, and the member never learned a
-- professional-initiated appointment existed. Found on-device 2026-08-01.
--
-- WHY THE FIX IS SHAPED THIS WAY
--
-- The trigger now fires on `insert or update of status`. The function guards
-- 'pending' rather than comparing against `old`, because on INSERT there is no
-- `old` row to compare against -- a member's own request still raises no
-- notification (nobody has acted on it yet), while a row landing directly at
-- 'confirmed' now does. The existing UPDATE guard (`new.status is not
-- distinct from old.status`) only makes sense when `old` exists, so it is
-- conditioned on `tg_op = 'UPDATE'`.
--
-- ORDERING
--
-- Depends on patches/010 (the function and trigger it replaces). Independent
-- of 009 and 011.
--
-- Idempotent: `create or replace function` plus `drop trigger if
-- exists` / `create trigger`, safe to run any number of times.
--
-- Also fixed in the SOURCE file -- supabase/patches/010-push-notifications.sql
-- -- so a fresh install is not born with the hole. Same split as patches/008
-- and 011: this patch repairs the database that exists, the source file
-- repairs the one built next.

create or replace function notify_on_appointment_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  if new.status = 'pending' then
    return null;
  end if;

  perform public.notify_user(
    new.member_id,
    'Appointment ' || new.status,
    to_char(new.starts_at, 'Dy DD Mon at HH24:MI'),
    '/m/trainer/appointments');
  return null;
exception when others then
  raise warning 'notify_on_appointment_status failed: %', sqlerrm;
  return null;
end $$;

drop trigger if exists on_appointment_status_notify on appointments;
create trigger on_appointment_status_notify
  after insert or update of status on appointments
  for each row execute function notify_on_appointment_status();

-- Every row must read PASS.
select
  check_name,
  actual,
  expected,
  case when actual = expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('appointment trigger fires on insert or update of status',
     (select (pg_get_triggerdef(oid) ~* 'INSERT OR UPDATE OF status')::text
      from pg_trigger
      where tgname = 'on_appointment_status_notify' and not tgisinternal),
     'true')
) as t(check_name, actual, expected);
