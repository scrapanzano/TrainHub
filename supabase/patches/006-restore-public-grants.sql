-- Restore the table privileges that make `public` reachable from the app.
--
-- WHY THIS EXISTS
--
-- PostgREST connects as `anon` and switches to `authenticated` once it has
-- validated the JWT.  Postgres checks the table GRANT *before* it evaluates any
-- Row Level Security policy, so a table with flawless RLS and no grant answers
-- every request with:
--
--   42501  permission denied for table profiles
--
-- A Supabase project ships those grants already.  They are lost by
-- `drop schema public cascade`, which is the usual way to start the schema over
-- after a half-applied run.  Recreating the schema and running
--
--   grant all on all tables in schema public to anon, authenticated, service_role;
--
-- is NOT enough on its own: `ON ALL TABLES` applies only to the tables that
-- exist at the instant it runs, and immediately after `create schema public`
-- there are none.  Every table `schema.sql` creates afterwards is then born
-- unreachable, and the failure surfaces much later as a login that reaches the
-- app shell and dies on "Profile unavailable".
--
-- The `alter default privileges` statements at the end are the missing half:
-- they make every table created *from now on* inherit the grant, which is what
-- Supabase's own bootstrap does.
--
-- ON `grant all` TO `anon`
--
-- This looks alarming and is the platform default.  These grants are not the
-- security boundary -- Row Level Security is, and `supabase/policies.sql` puts
-- a policy on all sixteen tables.  Every policy either compares against
-- `auth.uid()` or carries an explicit `auth.uid() is not null` guard, so an
-- anonymous caller holding the publishable key still reads nothing.  Phase 0
-- shipped one policy that failed that rule and it was fixed in
-- `patches/001-fix-profiles-anon-leak.sql`; `verify.sql` cannot catch that class
-- of hole, so it is checked by probing RLS from an anonymous client instead.
--
-- Idempotent: granting a privilege that is already held is a no-op.  Safe to run
-- on a healthy project.

grant usage on schema public to anon, authenticated, service_role;

-- Everything that exists right now.
grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines  in schema public to anon, authenticated, service_role;

-- Everything created from now on.  Without this, the next `create table` in
-- schema.sql repeats the whole failure.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on routines to anon, authenticated, service_role;

-- Every row must read PASS.  A count below 16 means a table is still
-- unreachable and the app will fail on it with 42501.
select
  check_name,
  actual,
  expected,
  case when actual = expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('tables the app role can read',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'select')),
     '16'),
    ('tables the app role can write',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'insert')),
     '16'),
    -- `anon` needs the grant too: the login screen and the sign-in flow issue
    -- requests before a session exists, and RLS is what keeps those empty.
    ('tables the anonymous role can read',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('anon', format('%I.%I', schemaname, tablename), 'select')),
     '16'),
    ('schema is usable by the app role',
     (select has_schema_privilege('authenticated', 'public', 'usage')::text), 'true')
) as t(check_name, actual, expected);
