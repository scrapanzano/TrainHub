-- Patch 013 -- one row per attempt at a workout session.
--
-- WHAT THIS REPLACES
--
-- `workout_sessions.status` was a single enum column: one session, one state,
-- forever. A real training protocol repeats weekly for three or four months,
-- so that column answers the wrong question -- it says "was this session ever
-- done" when the app needs "was it done THIS week". After one pass through the
-- plan, every session read `completed` and stayed that way.
--
-- Worse, `set_logs` had no attempt to belong to, so the embedded count in
-- `src/data/workouts.js` was a LIFETIME total. In week two a three-set exercise
-- would have read `6/3`, nothing would ever have completed again, and the
-- session-completion dialog would never have fired.
--
-- WHY THE FIX IS SHAPED THIS WAY
--
-- A run owns the clock, the outcome and the member's note, and every set points
-- at one. Session state stops being stored and becomes a function of the runs
-- inside the current ISO week -- see `src/features/workout/week.js`. There is
-- therefore no reset job to schedule, which matters: this project has no
-- pg_cron to schedule one on.
--
-- It also removes any need to delete a set. Abandoning marks the run and leaves
-- its rows alone. A DELETE would have to race the offline replay queue: a set
-- logged underground can land AFTER the delete meant to remove it, and no
-- ordering fixes that in general.
--
-- `workout_sessions.status` is deliberately NOT dropped. It stops being read
-- and written by the application from this patch onward; removing the column
-- would be a destructive migration on a live database for no gain.
--
-- ORDERING
--
-- Depends on schema.sql (`workout_sessions`, `set_logs`, `profiles`), on
-- policies.sql (`owns_member`), and on patches/006 for the default privileges
-- this table inherits. Independent of 009 through 012.
--
-- Idempotent: every statement is guarded. Safe to run any number of times.

do $$ begin
  create type run_outcome as enum ('completed', 'partial', 'abandoned');
exception when duplicate_object then null;
end $$;

create table if not exists workout_runs (
  id              uuid primary key,
  session_id      uuid not null references workout_sessions(id) on delete cascade,
  member_id       uuid not null references profiles(id) on delete cascade,
  -- Supplied by the client, never defaulted to now(), for the same reason
  -- `set_logs.performed_at` is: this write can sit paused offline for hours and
  -- be replayed on reconnect, and now() at insert time would record a workout
  -- that started at 18:00 as starting at 23:00.
  started_at      timestamptz not null,
  paused_at       timestamptz,
  paused_total_ms int not null default 0,
  ended_at        timestamptz,
  -- Null while the run is open. `abandoned` means the sets are kept but count
  -- for nothing: the session returns to "to do" and can be done again today.
  outcome         run_outcome,
  -- The member's word to their coach about how it went, written once at the
  -- summary. Null is the ordinary case.
  note            text
);

create index if not exists workout_runs_member_started_idx
  on workout_runs (member_id, started_at desc);
create index if not exists workout_runs_session_started_idx
  on workout_runs (session_id, started_at desc);

-- At most one open workout per member, enforced here and not only in the UI:
-- two phones signed into one account must not be able to open two, and the
-- mini-player has exactly one run to show.
create unique index if not exists workout_runs_one_open_per_member
  on workout_runs (member_id) where ended_at is null;

alter table set_logs add column if not exists run_id uuid
  references workout_runs(id) on delete cascade;
create index if not exists set_logs_run_idx on set_logs (run_id);

alter table workout_runs enable row level security;

-- The member owns their runs outright. `owns_member` grants the professional
-- read access to their own clients' runs and nothing more: a trainer may see
-- that a workout happened and how it went, and may never invent one.
--
-- Both clauses reach `auth.uid()` -- `owns_member` through the helper, the
-- second directly. A policy whose `using` clause never mentions it is public to
-- anyone holding the publishable key, which ships in the JS bundle.
drop policy if exists workout_runs_select on workout_runs;
create policy workout_runs_select on workout_runs
  for select using (owns_member(member_id));

drop policy if exists workout_runs_write_self on workout_runs;
create policy workout_runs_write_self on workout_runs
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- Every row must read PASS.
--
-- `member can insert` FAIL means the table was created without inheriting the
-- grants patches/006 installed as default privileges. RLS would then be
-- irrelevant: Postgres checks the GRANT before any policy and answers
-- "42501 permission denied" one gate earlier. The fix is to re-run patches/006.
select 'table exists' as check_name,
  (to_regclass('public.workout_runs') is not null) as ok
union all
select 'rls enabled',
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'workout_runs')
union all
select 'two policies',
  (select count(*) = 2 from pg_policies
   where schemaname = 'public' and tablename = 'workout_runs')
union all
select 'one open run per member enforced',
  (select count(*) = 1 from pg_indexes
   where schemaname = 'public' and tablename = 'workout_runs'
     and indexdef ilike '%unique%' and indexdef ilike '%ended_at is null%')
union all
select 'set_logs.run_id exists',
  (select count(*) = 1 from information_schema.columns
   where table_schema = 'public' and table_name = 'set_logs' and column_name = 'run_id')
union all
select 'member can select',
  has_table_privilege('authenticated', 'public.workout_runs', 'select')
union all
select 'member can insert',
  has_table_privilege('authenticated', 'public.workout_runs', 'insert')
union all
select 'member can update',
  has_table_privilege('authenticated', 'public.workout_runs', 'update');
