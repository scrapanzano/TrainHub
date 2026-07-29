-- TrainHub Phase 0 database checks.
--
-- One query on purpose: the Supabase SQL editor only renders the result of the
-- LAST statement in a script, so a file of separate SELECTs silently shows you
-- just the final one.
--
-- Run after schema.sql + policies.sql + seed.sql.  Every row must read PASS.
--
-- Caveat: this runs as the dashboard's privileged role, which bypasses RLS.
-- It proves the rows and policies EXIST; it does not prove the policies are
-- correct from the app's point of view. That is verified in Task 7, by signing
-- in as each demo account and seeing what comes back.

select
  check_name,
  coalesce(actual, '(null)') as actual,
  expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end as status
from (
  values
    -- Schema ---------------------------------------------------------------
    ('public tables',
     (select count(*)::text from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'), '16'),

    -- Security -------------------------------------------------------------
    ('tables with RLS enabled',
     (select count(*)::text from pg_tables
      where schemaname = 'public' and rowsecurity), '16'),
    -- RLS switched on with zero policies denies everything: it passes the
    -- check above while silently breaking every read the app makes.
    ('tables with at least one policy',
     (select count(distinct tablename)::text from pg_policies
      where schemaname = 'public'), '16'),

    -- Seed contents --------------------------------------------------------
    ('profiles',           (select count(*)::text from profiles),           '2'),
    ('exercises',          (select count(*)::text from exercises),          '10'),
    ('workout_plans',      (select count(*)::text from workout_plans),      '1'),
    ('workout_sessions',   (select count(*)::text from workout_sessions),   '4'),
    ('session_exercises',  (select count(*)::text from session_exercises),  '6'),
    ('nutrition_plans',    (select count(*)::text from nutrition_plans),    '1'),
    ('meals',              (select count(*)::text from meals),              '4'),
    ('availability',       (select count(*)::text from availability),       '10'),
    ('appointments',       (select count(*)::text from appointments),       '3'),
    ('threads',            (select count(*)::text from threads),            '1'),
    ('messages',           (select count(*)::text from messages),           '3'),
    ('rewards',            (select count(*)::text from rewards),            '3'),
    ('checkins',           (select count(*)::text from checkins),           '6'),

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
