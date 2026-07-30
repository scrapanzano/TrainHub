-- The member's QR access badge.
--
-- A token is one row, valid for sixty seconds, redeemable once.  The
-- alternatives considered were a token per day and a static token encoding the
-- member id; with either of those a screenshot of the badge, forwarded to a
-- friend, is a working key to the gym.
--
-- `expires_at` is a COLUMN DEFAULT, not a value the client sends.  Phase 2
-- shipped a bug where a skewed device clock corrupted stored times, and a badge
-- whose lifetime is decided by the phone showing it is not a lifetime at all.
-- The countdown on screen is cosmetic; this column is the truth.
--
-- The token itself is client-generated, like every other id in this app that
-- can be written more than once.
--
-- Idempotent: guarded throughout, safe to run twice.

create table if not exists checkin_tokens (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null default now() + interval '60 seconds',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists checkin_tokens_member_expires_idx
  on checkin_tokens (member_id, expires_at desc);

alter table checkin_tokens enable row level security;

-- A member may mint and read their OWN tokens.  There is deliberately no
-- update policy and no delete policy for anyone: the only writer of `used_at`
-- is redeem_checkin_token() below, which is `security definer` and bypasses
-- RLS.  A professional never receives the right to READ this table -- that
-- permission is exactly what would let someone enumerate valid badges.
drop policy if exists checkin_tokens_insert_self on checkin_tokens;
create policy checkin_tokens_insert_self on checkin_tokens
  for insert with check (member_id = auth.uid());

drop policy if exists checkin_tokens_select_self on checkin_tokens;
create policy checkin_tokens_select_self on checkin_tokens
  for select using (member_id = auth.uid());

-- Redeem one badge.
--
-- Returns a STATUS rather than raising, because "unknown", "already used" and
-- "expired" are three different things to the person at the desk and each one
-- needs its own message.  The only raise is the authorisation check: a member
-- calling this is not a bad badge, it is a caller who should not be here.
--
-- `for update` locks the row for the length of the transaction, so two
-- simultaneous scans of the same QR cannot both find it unused.
--
-- SECURITY: this function runs `security definer` and bypasses RLS. All
-- relation references are schema-qualified and search_path is empty. Postgres
-- searches pg_temp before search_path when resolving unqualified relations, so
-- an authenticated professional could create a session-local temp table named
-- `checkin_tokens` and shadow the real one, forging a check-in. Empty
-- search_path + qualification closes that window.
create or replace function redeem_checkin_token(p_token text)
returns table (
  status              text,
  member_id           uuid,
  full_name           text,
  subscription_status text,
  subscription_until  date
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.checkin_tokens%rowtype;
begin
  if not public.is_professional() then
    raise exception 'only a professional may redeem a badge'
      using errcode = '42501';
  end if;

  select * into v_row from public.checkin_tokens t
  where t.token = p_token
  for update;

  if not found then
    return query select 'unknown'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  if v_row.used_at is not null then
    return query select 'used'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  update public.checkin_tokens set used_at = now() where id = v_row.id;
  insert into public.checkins (member_id, scanned_by_id) values (v_row.member_id, auth.uid());

  return query
    select 'ok'::text, p.id, p.full_name,
           p.subscription_status::text, p.subscription_until
    from public.profiles p
    where p.id = v_row.member_id;
end $$;

-- Every row must read PASS.
--
-- `member can insert` FAIL means the table was created without inheriting the
-- grants `patches/006` installed as default privileges -- RLS would then be
-- irrelevant, because Postgres checks the grant first and answers
-- "42501 permission denied" before any policy runs.
select
  'table exists' as check,
  (to_regclass('public.checkin_tokens') is not null) as ok
union all
select 'rls enabled',
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'checkin_tokens')
union all
select 'two policies, no update policy',
  (select count(*) = 2 from pg_policies
   where schemaname = 'public' and tablename = 'checkin_tokens')
union all
select 'redeem function exists',
  (to_regprocedure('public.redeem_checkin_token(text)') is not null)
union all
select 'member can insert',
  has_table_privilege('authenticated', 'public.checkin_tokens', 'insert')
union all
select 'member can select',
  has_table_privilege('authenticated', 'public.checkin_tokens', 'select')
union all
select 'redeem runs with an empty search path',
  (select 'search_path=' = any(p.proconfig)
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'redeem_checkin_token');
