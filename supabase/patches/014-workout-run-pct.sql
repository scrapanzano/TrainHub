-- Patch 014 -- record how much of a session a run actually got through.
--
-- WHAT WENT WRONG
--
-- `patches/013` created `workout_runs` without a `pct` column. The design it
-- implements calls for each session card on the plan screen to state its own
-- outcome -- "Completed on Monday", "Stopped at 60%", "Not done yet" -- and the
-- percentage is the one part of that the table could not answer.
--
-- Deriving it instead would mean loading every run's `set_logs` just to draw a
-- list of four cards, on the screen the member opens most often, on a phone
-- that may be offline. That is a poor trade for one integer.
--
-- WHY THE FIX IS SHAPED THIS WAY
--
-- Nullable, with no default and no backfill. A run that closed before this
-- patch has no percentage and never will: the honest rendering of that is
-- "Stopped early" with no figure, which is what `SessionCard` prints when `pct`
-- is null. Inventing a number for those rows would be worse than omitting one.
--
-- Written once, by `endRun`, at the moment the run closes, from the same ratio
-- the points are computed from. They are not equal to the unit -- a whole
-- percentage is a lossy carrier, and one set of six is 16% while the award is
-- floor(30/6) = 5 rather than floor(30 * 0.16) = 4 -- but they can never tell
-- opposite stories: no points without progress, no full award without a full
-- session, and neither moves while the other stands still. The self-check
-- beside `summary.js` pins exactly that.
--
-- ORDERING
--
-- Depends on patches/013. Independent of everything else.
--
-- Idempotent: `add column if not exists`, safe to run any number of times.
--
-- Also fixed in the SOURCE file -- supabase/patches/013-workout-runs.sql -- so
-- a fresh install is not born without it. Same split as patches/008, 011 and
-- 012: this patch repairs the database that exists, the source file repairs the
-- one built next.

alter table workout_runs add column if not exists pct int;

-- Every row must read PASS.
select 'pct column exists' as check_name,
  (select count(*) = 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'workout_runs' and column_name = 'pct') as ok
union all
select 'pct is nullable',
  (select is_nullable = 'YES' from information_schema.columns
   where table_schema = 'public' and table_name = 'workout_runs' and column_name = 'pct')
union all
-- The column inherits the table's grants; this confirms nothing was lost.
select 'member can still write runs',
  has_table_privilege('authenticated', 'public.workout_runs', 'update');
