-- Patch 008 -- stop a thread member from rewriting the other party's messages.
--
-- WHAT WENT WRONG
--
-- `policies.sql` declares the read-receipt policy with a `using` clause and no
-- `with check`:
--
--   create policy messages_update_read on messages
--     for update using (
--       exists (select 1 from threads t
--               where t.id = thread_id
--                 and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
--     );
--
-- When `with check` is omitted PostgreSQL reuses `using` as the check, so the
-- policy permits an UPDATE to write *any* value into *any* column of any row in
-- a thread the caller belongs to.  Combined with `patches/006`'s
-- `grant all on all tables` -- which includes UPDATE on every column -- either
-- party could:
--
--   * rewrite a `body` they did not send, and the forgery is indistinguishable
--     from the original because `sender_id` never changes;
--   * set `read_at` back to null, so the other person's unread badge sticks and
--     cannot be cleared.
--
-- Every sibling policy in `policies.sql` carries an explicit `with check`; this
-- was the only one that did not.
--
-- WHY THE FIX IS SHAPED THIS WAY
--
-- The column grant is the load-bearing half, not the policy.  Postgres checks
-- the table GRANT *before* it evaluates any RLS policy (see `patches/006`), so
-- narrowing UPDATE to the single `read_at` column rejects a `body` rewrite at
-- the privilege gate -- one layer earlier than RLS, and it cannot be undone by a
-- future policy edit.  The tightened `with check` is the second layer: it
-- repeats the thread-membership test and adds `read_at is not null`, which is
-- what blocks un-reading.
--
-- Only the `authenticated` role gets the column grant back.  `anon` gets
-- nothing: an unauthenticated caller has no `auth.uid()` and so could never
-- satisfy the policy anyway, and `service_role` is left untouched because it
-- bypasses RLS by design and runs nowhere near the browser.
--
-- WHAT THE APP STILL DOES
--
-- `markThreadRead` in `src/data/chat.js` is the only UPDATE the app issues
-- against this table.  It writes `read_at` and nothing else, filtered to
-- `sender_id <> me` and `read_at is null`, so it passes both the column grant
-- and the new check.
--
-- ORDERING
--
-- Must run AFTER `patches/006-restore-public-grants.sql`.  006 grants UPDATE on
-- every column of every table; re-running it after this file would undo the
-- revoke below, so if 006 is ever replayed, replay 008 after it.
--
-- Idempotent: revoking a privilege that is not held, granting one that is, and
-- `drop policy if exists` are all no-ops on a second run.

revoke update on public.messages from anon, authenticated;
grant update (read_at) on public.messages to authenticated;

drop policy if exists messages_update_read on public.messages;

create policy messages_update_read on public.messages
  for update
  using (
    exists (select 1 from threads t
            where t.id = thread_id
              and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
  )
  with check (
    exists (select 1 from threads t
            where t.id = thread_id
              and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
    -- Marking read is the only legitimate UPDATE.  Without this, a thread
    -- member could clear `read_at` and pin the other person's unread badge.
    and read_at is not null
  );

-- Every row must read PASS.
--
-- `can update body` FAIL is the original hole still open: the revoke did not
-- take, most likely because `patches/006` was re-run after this file.
-- `check clause present` FAIL means the policy was recreated without it and
-- `using` is being reused as the check again.
select
  check_name,
  actual,
  expected,
  case when actual = expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('app role can update read_at',
     (select has_column_privilege('authenticated', 'public.messages', 'read_at', 'update')::text),
     'true'),
    ('app role can update body',
     (select has_column_privilege('authenticated', 'public.messages', 'body', 'update')::text),
     'false'),
    ('anon role can update read_at',
     (select has_column_privilege('anon', 'public.messages', 'read_at', 'update')::text),
     'false'),
    ('check clause present',
     (select (with_check is not null)::text from pg_policies
      where schemaname = 'public'
        and tablename = 'messages'
        and policyname = 'messages_update_read'),
     'true'),
    ('check clause blocks un-reading',
     (select (with_check like '%read_at IS NOT NULL%')::text from pg_policies
      where schemaname = 'public'
        and tablename = 'messages'
        and policyname = 'messages_update_read'),
     'true')
) as t(check_name, actual, expected);
