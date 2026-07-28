-- Re-base the demo agenda onto today.
--
-- seed.sql builds the appointments as `current_date + time '10:00'`, which is
-- right at the moment it runs and wrong every day after: `timestamptz` stores an
-- absolute instant, so the "today" agenda ages into the past and the member's
-- Home screen falls back to its empty state during a demo.
--
-- This shifts every appointment by the gap between the earliest one and today,
-- which preserves the shape seed.sql created -- two appointments today, one in
-- two days -- instead of collapsing them onto a single date.
--
-- Idempotent: run it again on the same day and the gap is zero, so nothing
-- moves.  Safe to run before every demo.

update appointments a
set starts_at = a.starts_at + shift.gap,
    ends_at   = a.ends_at   + shift.gap
from (
  select (current_date - min(starts_at)::date) * interval '1 day' as gap
  from appointments
) as shift
where shift.gap <> interval '0 days';

-- Confirm the agenda landed on today.
select
  starts_at::date            as day,
  starts_at::time            as starts,
  kind,
  status,
  starts_at::date = current_date as is_today
from appointments
order by starts_at;
