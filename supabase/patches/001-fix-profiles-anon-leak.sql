-- Patch 001 -- close an anonymous read leak on `profiles`.
--
-- The original `profiles_select_professionals` policy was:
--
--   for select using (role = 'professional')
--
-- That predicate never mentions the caller, so PostgreSQL evaluates it as true
-- for an unauthenticated request too. Anyone holding the publishable key --
-- which ships inside the JS bundle and is public by design -- could read every
-- professional's profile row without signing in.
--
-- Verified before the fix: an anonymous client got 1 row from `profiles`.
-- Expected after the fix: 0 rows.
--
-- Safe to run more than once.

drop policy if exists profiles_select_professionals on profiles;

create policy profiles_select_professionals on profiles
  for select using (auth.uid() is not null and role = 'professional');

-- Confirm the policy now references the caller.
select policyname, qual
from pg_policies
where schemaname = 'public'
  and tablename = 'profiles'
  and policyname = 'profiles_select_professionals';
