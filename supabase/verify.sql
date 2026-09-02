-- TrainHub database checks after patches 001-016.
--
-- One query on purpose: the Supabase SQL editor only renders the result of the
-- LAST statement in a script, so a file of separate SELECTs silently shows you
-- just the final one.
--
-- Run after schema.sql + policies.sql + seed.sql and every patch through 016.
-- The schema/security checks expect patches 015-016. Every row must read PASS.
--
-- Caveat: this runs as the dashboard's privileged role, which bypasses RLS.
-- It proves the rows and policies EXIST; it does not prove the policies are
-- correct from the app's point of view. That is verified by probe-rls.mjs and
-- probe-security.mjs, which sign in through the same public API as the app.

select
  check_name,
  coalesce(actual, '(null)') as actual,
  expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end as status
from (
  values
    -- Schema ---------------------------------------------------------------
    -- schema.sql now declares the complete 19-table fresh-install shape. The
    -- historical create-if-missing patches remain safe to replay in order.
    ('public tables',
     (select count(*)::text from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'), '19'),

    -- Security -------------------------------------------------------------
    ('tables with RLS enabled',
     (select count(*)::text from pg_tables
      where schemaname = 'public' and rowsecurity), '19'),
    -- RLS switched on with zero policies denies everything: it passes the
    -- check above while silently breaking every read the app makes.
    --
    -- 18, one short of the table count, and that gap is the assertion rather
    -- than a gap in coverage: `app_config` holds the secret that authenticates
    -- the database to the notify Edge Function and is deliberately policy-less
    -- AND grant-less, so RLS-on-with-no-policy denies every PostgREST caller
    -- and the missing grant denies them one gate earlier.  Only
    -- `notify_user()`, which is `security definer`, reads it.  If any of the
    -- two read rows below ever read 19, that table became reachable from the
    -- browser.
    ('tables with at least one policy',
     (select count(distinct tablename)::text from pg_policies
      where schemaname = 'public'), '18'),
    -- RLS is the second gate, not the first.  PostgREST connects as `anon` and
    -- switches to `authenticated`, and Postgres checks the table GRANT before it
    -- ever evaluates a policy -- so a table with perfect RLS and no grant fails
    -- with `42501 permission denied`, which the two checks above cannot see.
    -- This is not hypothetical: `drop schema public cascade` takes the grants
    -- with it, and `grant on all tables` only touches tables that already exist,
    -- so every table created afterwards is born unreachable.
    ('tables the app role can read',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'select')),
     '18'),
    ('tables the app role can write',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'insert')),
     -- Patch 015 removes direct INSERT from the ten protected history and
     -- relationship tables. The remaining eight use ordinary RLS writes.
     '8'),

    ('protected tables reject direct insert privileges',
     (select count(*)::text from (values
       ('workout_plans'), ('workout_sessions'), ('session_exercises'),
       ('workout_runs'), ('set_logs'), ('rewards'), ('appointments'),
       ('threads'), ('checkins'), ('body_metrics')
     ) as protected(tablename)
     where not has_table_privilege(
       'authenticated', format('public.%I', protected.tablename), 'insert')),
     '10'),

    ('patch 015 secure operations',
     (select count(*)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'create_appointment_secure', 'set_appointment_status_secure',
          'ensure_assigned_thread', 'save_body_metric_secure',
          'create_workout_plan_secure', 'create_workout_session_secure',
          'add_session_exercise_secure', 'start_workout_run_secure',
          'pause_workout_run_secure', 'resume_workout_run_secure',
          'log_workout_set_secure', 'close_workout_run_secure',
          'save_workout_run_note_secure'
        )
        and p.prosecdef
        and coalesce(
          p.proconfig && array['search_path=', 'search_path=""'], false)),
     '13'),

    ('workout completion counts only logged sets',
     (select coalesce(
        regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
          like '%least(coalesce(logged.amount,0),item.target_sets)%',
        false)::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'close_workout_run_secure'),
     'true'),

    -- Seed contents --------------------------------------------------------
    -- These are minimums, not exact counts: using the app legitimately adds
    -- workouts, messages, rewards, appointments and check-ins. Exact seed
    -- checks belong to seed.sql and patch 005 at the moment they run.
    ('at least 6 profiles',          (select (count(*) >= 6)::text from profiles),          'true'),
    ('at least 10 exercises',        (select (count(*) >= 10)::text from exercises),        'true'),
    ('at least 5 workout plans',     (select (count(*) >= 5)::text from workout_plans),     'true'),
    ('at least 16 workout sessions', (select (count(*) >= 16)::text from workout_sessions), 'true'),
    ('at least 6 prescribed exercises',
     (select (count(*) >= 6)::text from session_exercises), 'true'),
    ('at least 1 nutrition plan',    (select (count(*) >= 1)::text from nutrition_plans),   'true'),
    ('at least 4 meals',             (select (count(*) >= 4)::text from meals),             'true'),
    ('at least 10 availability rows',(select (count(*) >= 10)::text from availability),     'true'),
    ('at least 8 appointments',      (select (count(*) >= 8)::text from appointments),      'true'),
    ('at least 1 thread',            (select (count(*) >= 1)::text from threads),           'true'),
    ('at least 3 messages',          (select (count(*) >= 3)::text from messages),          'true'),
    ('at least 3 rewards',           (select (count(*) >= 3)::text from rewards),           'true'),
    ('at least 6 checkins',          (select (count(*) >= 6)::text from checkins),          'true'),
    ('at least 5 body metrics',      (select (count(*) >= 5)::text from body_metrics),      'true'),

    -- Demo accounts --------------------------------------------------------
    ('professional profile',
     (select role::text || '/' || specialty::text
      from profiles where full_name = 'Coach Andrea'), 'professional/both'),
    ('member profile',
     (select role::text from profiles where full_name = 'Daniel Aresta'),
     'member'),
    ('member linked to professional',
     (select case when assigned_pro_id is not null then 'linked' else 'unlinked' end
      from profiles where full_name = 'Daniel Aresta'), 'linked')
) as t(check_name, actual, expected);
