-- TrainHub Phase 0 database checks.
--
-- One query on purpose: the Supabase SQL editor only renders the result of the
-- LAST statement in a script, so a file of separate SELECTs silently shows you
-- just the final one.
--
-- Run after schema.sql + policies.sql + seed.sql, and after the patches.  The
-- five schema/security counts below expect `patches/009` (checkin_tokens) and
-- `patches/010` (app_config) to have been applied; run before them they read two
-- short.  Every row must read PASS, except the four seed counts -- see the
-- comment on them.
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
    -- 18 = the 16 tables schema.sql creates, plus `checkin_tokens`
    -- (`patches/009`) and `app_config` (`patches/010`).  The three counts
    -- further down read 17, not 18, and the comment there says why.
    ('public tables',
     (select count(*)::text from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'), '18'),

    -- Security -------------------------------------------------------------
    ('tables with RLS enabled',
     (select count(*)::text from pg_tables
      where schemaname = 'public' and rowsecurity), '18'),
    -- RLS switched on with zero policies denies everything: it passes the
    -- check above while silently breaking every read the app makes.
    --
    -- 17, one short of the table count, and that gap is the assertion rather
    -- than a gap in coverage: `app_config` holds the secret that authenticates
    -- the database to the notify Edge Function and is deliberately policy-less
    -- AND grant-less, so RLS-on-with-no-policy denies every PostgREST caller
    -- and the missing grant denies them one gate earlier.  Only
    -- `notify_user()`, which is `security definer`, reads it.  If any of the
    -- three rows below ever reads 18, that table became reachable from the
    -- browser.
    ('tables with at least one policy',
     (select count(distinct tablename)::text from pg_policies
      where schemaname = 'public'), '17'),
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
     '17'),
    ('tables the app role can write',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'insert')),
     '17'),

    -- Seed contents --------------------------------------------------------
    -- The four counts below (`profiles`, `workout_plans`, `workout_sessions`,
    -- `appointments`) are the seed.sql-ONLY baseline: what a fresh install
    -- reads after schema.sql + policies.sql + seed.sql and nothing else. They
    -- are deliberately NOT bumped to match `patches/005-demo-clients.sql`,
    -- because doing so would break this exact fresh-install-without-demo-data
    -- path -- the whole reason the schema patch and the demo-data patch are
    -- two separate files in the first place.
    --
    -- Once `patches/005-demo-clients.sql` has also been run, these four rows
    -- read FAIL against the numbers below.  That is expected, not a bug:
    --   profiles          2  -> 6   (Daniel + Coach Andrea + four demo clients)
    --   workout_plans     1  -> 5   (the seeded plan + one per demo client)
    --   workout_sessions  4  -> 16  (the seeded four + three per demo plan)
    --   appointments      3  -> 8   (the seeded three + five from the demo patch)
    -- `patches/005-demo-clients.sql` ends with its own PASS/FAIL block that
    -- checks the post-patch counts directly -- use that file's output to
    -- confirm the database once the demo data is loaded, not this one.
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
