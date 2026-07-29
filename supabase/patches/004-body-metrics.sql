-- Body measurements taken by the professional during a check-in.
--
-- pt/10 - Progress Tracking draws "Current Weight", "Weekly Trend" and a
-- "Weekly Check-In Note".  Nothing in the schema held any of them, so the
-- screen could only have been faked.  This table is what makes it honest.
--
-- The professional writes; the member reads.  A member cannot edit their own
-- measurements, which is the point of a coach taking them.
--
-- Idempotent: safe to run twice.

create table if not exists body_metrics (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references profiles(id) on delete cascade,
  recorded_by_id uuid references profiles(id) on delete set null,
  measured_on    date not null,
  weight_kg      numeric(5,2),
  note           text,
  created_at     timestamptz not null default now(),
  -- One reading per client per day.  This is also the upsert target, which is
  -- what makes a replayed offline save land on the same row instead of
  -- recording the same morning twice.
  unique (member_id, measured_on)
);

create index if not exists body_metrics_member_measured_idx
  on body_metrics (member_id, measured_on desc);

alter table body_metrics enable row level security;

drop policy if exists body_metrics_select on body_metrics;
create policy body_metrics_select on body_metrics
  for select using (owns_member(member_id));

drop policy if exists body_metrics_write_pro on body_metrics;
create policy body_metrics_write_pro on body_metrics
  for all using (is_professional() and owns_member(member_id))
  with check (is_professional() and owns_member(member_id));

-- Confirm the table is protected.  RLS enabled with zero policies denies
-- everything while still passing a `rowsecurity = true` check, so count both.
select
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'body_metrics') as rls_enabled,
  (select count(*) from pg_policies
   where schemaname = 'public' and tablename = 'body_metrics') as policy_count;
