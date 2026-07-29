-- Put `messages` on the Realtime publication.
--
-- Supabase streams a table's changes only if the table belongs to the
-- `supabase_realtime` publication.  A fresh project adds tables to it as they
-- are created, but `drop schema public cascade` -- used earlier in this project
-- to restart a half-applied schema -- removes them again, and nothing in the app
-- noticed because nothing used Realtime until now.  A missing publication entry
-- produces no error: the subscription connects, reports SUBSCRIBED, and simply
-- never fires.  That is the worst possible failure mode, so this file also
-- prints what the publication holds afterwards.
--
-- `replica identity full` makes the old row available on UPDATE payloads.  The
-- chat only reacts to INSERT, but read receipts are UPDATEs and a later feature
-- that wants them will need this; setting it now costs nothing on a table this
-- size.
--
-- Idempotent: guarded, so a second run changes nothing.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

alter table public.messages replica identity full;

-- Must list `messages`.  If it does not, the chat will look connected and stay
-- silent.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
order by tablename;
