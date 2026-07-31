-- Patch 011 -- close the pg_temp shadowing hole in the three oldest
-- `security definer` functions.
--
-- WHAT WENT WRONG
--
-- `policies.sql` declares both RLS helpers, and `schema.sql` declares the
-- auth trigger, as:
--
--   language sql security definer stable set search_path = public as $$
--     select exists (select 1 from profiles where id = auth.uid() ...);
--   $$;
--
-- `set search_path = public` looks like the hardening.  It is not.  Postgres
-- resolves an unqualified RELATION through the temporary schema BEFORE it walks
-- search_path, and every signed-in role may create temp tables.  So any
-- authenticated caller can do:
--
--   create temp table profiles (id uuid, role text, assigned_pro_id uuid);
--   insert into profiles values (auth.uid(), 'professional', null);
--
-- and `is_professional()` -- running as its owner, bypassing RLS -- answers
-- true for the rest of that session.  `is_professional()` is the gate on every
-- professional-only policy in the app, and on `redeem_checkin_token()`, so this
-- is a member promoting themselves to staff.  `owns_member()` shadowed the same
-- way hands one member every other member's plans, meals, metrics and
-- appointments.
--
-- `patches/009` hardened `redeem_checkin_token()` with `set search_path = ''`
-- and full qualification, and asserts it in a PASS row -- but its very first
-- statement calls `public.is_professional()`, and an empty search path in the
-- CALLER does not travel into the callee.  The hardened function was gated by
-- an unhardened one.
--
-- WHY THE FIX IS SHAPED THIS WAY
--
-- `set search_path = ''` plus a `public.` prefix on every relation is the only
-- form that cannot be shadowed: with an empty path there is nothing to search,
-- and a qualified name never consults pg_temp.  Built-ins (`auth.uid()`,
-- `coalesce`, `now()`) need no prefix -- pg_catalog is searched first whatever
-- search_path says -- but `user_role` is a type in `public` and does.
--
-- Bodies and semantics are otherwise byte-for-byte what they were; this patch
-- changes where names resolve, nothing about what the functions answer.
--
-- ORDERING
--
-- Independent of every other patch.  `create or replace function` keeps the
-- existing OID, so the policies that reference these helpers and the
-- `on_auth_user_created` trigger keep working without being recreated.
--
-- Idempotent: three `create or replace`, safe to run any number of times.
--
-- Note also fixed in the SOURCE files -- `supabase/policies.sql` and
-- `supabase/schema.sql` -- so the next fresh install is not born with the hole.
-- Same split as `patches/008`: the patch repairs the database that exists, the
-- source file repairs the one built next.

create or replace function public.is_professional() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'professional'
  );
$$;

create or replace function public.owns_member(target uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select target = auth.uid()
      or exists (
           select 1 from public.profiles
           where id = target and assigned_pro_id = auth.uid()
         );
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'member')
  );
  return new;
end;
$$;

-- Every row must read PASS.
--
-- Each row asserts the function's `proconfig` overlaps an empty search path,
-- checking both spellings Postgres might have stored it under. `search_path`
-- carries GUC_LIST_QUOTE, so the value passed to `set search_path = ''` is run
-- through `quote_identifier()` before it is stored, and an empty string comes
-- back quoted: the stored element is `search_path=""`, not `search_path=`. A
-- literal equality against either spelling alone is false on a correctly
-- patched database, which is why this is an overlap against both rather than
-- an equality against one. A FAIL means the function is still `set
-- search_path = public` and is still shadowable through pg_temp -- these rows
-- fail against the pre-patch database by construction, which is how you know
-- they ran.
select
  check_name,
  actual,
  expected,
  case when actual = expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('is_professional runs with an empty search path',
     (select (p.proconfig && array['search_path=', 'search_path=""'])::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_professional'),
     'true'),
    ('owns_member runs with an empty search path',
     (select (p.proconfig && array['search_path=', 'search_path=""'])::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'owns_member'),
     'true'),
    ('handle_new_user runs with an empty search path',
     (select (p.proconfig && array['search_path=', 'search_path=""'])::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user'),
     'true'),
    -- The trigger still points at the replaced function: `create or replace`
    -- keeps the OID, so this proves nothing was dropped and recreated loose.
    ('auth trigger still attached',
     (select count(*)::text from pg_trigger
      where tgname = 'on_auth_user_created' and not tgisinternal),
     '1')
) as t(check_name, actual, expected);
