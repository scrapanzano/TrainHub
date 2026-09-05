-- 025 — Storage for profile photos.
--
-- `profiles.avatar_url` has existed since `schema.sql` and has been writable by
-- its owner since patch 015 (`grant update (full_name, avatar_url, bio,
-- assigned_pro_id)`), but nothing ever wrote it: there was no bucket to put a
-- photo in. This patch is the missing half.
--
-- Layout: one object per user at `avatars/<user id>/avatar.jpg`, replaced in
-- place. The first path segment IS the owner's id, which is what every policy
-- below checks — a member can only ever write inside their own folder.
--
-- Read access is public. The bucket holds nothing but a photo the member chose
-- to show, `<img>` cannot send an Authorization header, and signing every
-- avatar URL would defeat the service worker's cache for the one asset that
-- appears on every screen. The path is a uuid, so it is not enumerable.
--
-- Apply in the Supabase SQL editor, after 001–024.

begin;

-- ---------------------------------------------------------------------------
-- The bucket
-- ---------------------------------------------------------------------------

-- Idempotent: re-running the patch must not fail, and must not silently widen
-- an existing bucket's limits either.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  -- The client re-encodes to a 512px JPEG before upload, which lands well
  -- under this. The limit is the backstop for a client that does not.
  2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Policies
--
-- `storage.objects` already has RLS enabled by Supabase; only the policies are
-- ours. Dropped first so the patch can be re-applied after an edit.
-- ---------------------------------------------------------------------------

drop policy if exists "avatars_read_public"   on storage.objects;
drop policy if exists "avatars_insert_own"    on storage.objects;
drop policy if exists "avatars_update_own"    on storage.objects;
drop policy if exists "avatars_delete_own"    on storage.objects;

-- Anyone may read. See the note above on why this is deliberate.
create policy "avatars_read_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- `storage.foldername(name)` splits the object path; element 1 is the first
-- segment. Comparing it to `auth.uid()` is what confines a member to their own
-- folder. Note the policy names `auth.uid()` explicitly: a `using` clause that
-- never mentions the caller is open to anyone holding the publishable key,
-- which ships in the JS bundle.
create policy "avatars_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The client uploads with `upsert: true`, which is an update when the object
-- already exists. Without this policy the first photo works and every later
-- one fails.
create policy "avatars_update_own"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatars_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

-- ---------------------------------------------------------------------------
-- PASS / FAIL
--
-- Run after the commit above. Every row must read PASS.
-- ---------------------------------------------------------------------------

select
  'bucket exists and is public' as check,
  case when exists (
    select 1 from storage.buckets where id = 'avatars' and public
  ) then 'PASS' else 'FAIL' end as result;

select
  'four avatar policies' as check,
  case when count(*) = 4 then 'PASS' else 'FAIL (' || count(*) || ')' end as result
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'avatars_%';

-- The hole `verify.sql` structurally cannot see: a write policy that never
-- mentions the caller would let anyone holding the publishable key overwrite
-- another member's photo.
select
  'every write policy names auth.uid()' as check,
  case when count(*) = 0 then 'PASS' else 'FAIL (' || count(*) || ')' end as result
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in ('avatars_insert_own', 'avatars_update_own', 'avatars_delete_own')
  and coalesce(qual, '') || coalesce(with_check, '') not like '%uid()%';

select
  'size limit is set' as check,
  case when (select file_size_limit from storage.buckets where id = 'avatars') is not null
       then 'PASS' else 'FAIL' end as result;
