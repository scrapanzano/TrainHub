-- TrainHub schema.  Run once in the Supabase SQL editor, before policies.sql.

create type user_role       as enum ('member', 'professional');
create type pro_specialty   as enum ('personal_trainer', 'nutritionist', 'both');
create type session_status  as enum ('todo', 'in_progress', 'completed');
create type appointment_kind as enum ('training', 'protocol', 'nutrition');
create type appointment_status as enum ('pending', 'confirmed', 'cancelled', 'done');
create type subscription_status as enum ('active', 'expired', 'suspended');
create type run_outcome as enum ('completed', 'partial', 'abandoned');

-- One row per auth user.  `specialty` is null for members; for professionals it
-- carries the role-unification decision from the design spec (a nutritionist is
-- a professional with a different specialty, not a separate role).
create table profiles (
  id                  uuid primary key references auth.users on delete cascade,
  role                user_role not null default 'member',
  specialty           pro_specialty,
  full_name           text not null,
  avatar_url          text,
  bio                 text,
  assigned_pro_id     uuid references profiles(id) on delete set null,
  subscription_status subscription_status not null default 'active',
  subscription_until  date,
  created_at          timestamptz not null default now(),
  constraint specialty_only_for_professionals
    check ((role = 'professional') = (specialty is not null))
);
create index on profiles (assigned_pro_id);

-- Catalogue of exercises, shared across all plans.  `name` is unique so the
-- catalogue cannot accumulate duplicate entries, and so seeding can use
-- `on conflict (name) do nothing`.
create table exercises (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  muscle_group text not null,
  equipment    text,
  instructions text,
  video_url    text,
  image_url    text
);

create table workout_plans (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references profiles(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  name        text not null,
  goal        text,
  level       text,
  weeks       int  not null default 4,
  expires_on  date,
  replaces_plan_id uuid,
  created_at  timestamptz not null default now(),
  constraint workout_plans_weeks_positive check (weeks > 0),
  constraint workout_plans_replaces_fk foreign key (replaces_plan_id)
    references workout_plans(id) on delete restrict
);
create index on workout_plans (member_id);
create unique index workout_plans_replaced_once_idx
  on workout_plans (replaces_plan_id) where replaces_plan_id is not null;

create table workout_sessions (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references workout_plans(id) on delete cascade,
  name       text not null,
  position   int  not null,
  status     session_status not null default 'todo',
  unique (plan_id, position)
);
create index on workout_sessions (plan_id);

-- An exercise as it appears inside one session, with its prescription.
create table session_exercises (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references workout_sessions(id) on delete cascade,
  exercise_id   uuid not null references exercises(id) on delete restrict,
  position      int  not null,
  target_sets   int  not null default 3,
  target_reps   int  not null default 10,
  target_weight numeric(6,2),
  rest_seconds  int  not null default 90,
  notes         text,
  unique (session_id, position),
  constraint session_exercises_values_valid check (
    position > 0 and target_sets > 0 and target_reps > 0
    and rest_seconds >= 0 and (target_weight is null or target_weight >= 0)
  )
);
create index on session_exercises (session_id);

-- One row per attempt at a repeatable workout session. Session state is
-- derived from these rows for the current ISO week; workout_sessions.status is
-- retained only for compatibility with old data.
create table workout_runs (
  id              uuid primary key,
  session_id      uuid not null references workout_sessions(id) on delete cascade,
  member_id       uuid not null references profiles(id) on delete cascade,
  started_at      timestamptz not null,
  paused_at       timestamptz,
  paused_total_ms int not null default 0,
  ended_at        timestamptz,
  outcome         run_outcome,
  pct             int,
  note            text,
  constraint workout_runs_values_valid check (
    paused_total_ms >= 0 and (pct is null or pct between 0 and 100)
    and (ended_at is null or ended_at >= started_at)
  )
);
create index workout_runs_member_started_idx
  on workout_runs (member_id, started_at desc);
create index workout_runs_session_started_idx
  on workout_runs (session_id, started_at desc);
create unique index workout_runs_one_open_per_member
  on workout_runs (member_id) where ended_at is null;

-- One row per set actually performed.  Written offline and replayed on
-- reconnect, so the client supplies `id` and the table tolerates re-inserts.
create table set_logs (
  id                  uuid primary key,
  session_exercise_id uuid not null references session_exercises(id) on delete cascade,
  run_id              uuid references workout_runs(id) on delete cascade,
  member_id           uuid not null references profiles(id) on delete cascade,
  set_number          int  not null,
  reps                int  not null,
  weight              numeric(6,2),
  performed_at        timestamptz not null default now(),
  constraint set_logs_values_valid check (
    set_number > 0 and reps > 0 and (weight is null or weight >= 0)
  )
);
create index on set_logs (member_id, performed_at desc);
create index on set_logs (session_exercise_id);
create index set_logs_run_idx on set_logs (run_id);
create unique index set_logs_run_exercise_number_idx
  on set_logs (run_id, session_exercise_id, set_number)
  where run_id is not null;

create table nutrition_plans (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  author_id  uuid references profiles(id) on delete set null,
  name       text not null,
  kcal_target int,
  protein_g  int,
  carbs_g    int,
  fat_g      int,
  created_at timestamptz not null default now()
);
create index on nutrition_plans (member_id);

create table meals (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references nutrition_plans(id) on delete cascade,
  name        text not null,
  time_of_day text not null,
  position    int  not null,
  items       jsonb not null default '[]'::jsonb,
  kcal        int,
  unique (plan_id, position)
);
create index on meals (plan_id);

-- Recurring weekly availability, stored as local wall-clock times.
create table availability (
  id          uuid primary key default gen_random_uuid(),
  pro_id      uuid not null references profiles(id) on delete cascade,
  weekday     int  not null check (weekday between 0 and 6),
  starts_at   time not null,
  ends_at     time not null,
  check (ends_at > starts_at)
);
create index on availability (pro_id);

create table appointments (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  pro_id     uuid not null references profiles(id) on delete cascade,
  kind       appointment_kind not null,
  status     appointment_status not null default 'pending',
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  notes      text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on appointments (member_id, starts_at);
create index on appointments (pro_id, starts_at);

-- Exactly one thread per member/professional pair.
create table threads (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  pro_id     uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (member_id, pro_id)
);

create table messages (
  id         uuid primary key,
  thread_id  uuid not null references threads(id) on delete cascade,
  sender_id  uuid not null references profiles(id) on delete cascade,
  body       text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (thread_id, created_at desc);

create table rewards (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references profiles(id) on delete cascade,
  code        text not null,
  title       text not null,
  description text,
  points      int  not null default 0,
  run_id      uuid,
  workout_session_id uuid,
  reward_day  date,
  earned_at   timestamptz not null default now(),
  unique (member_id, code),
  constraint rewards_run_fk foreign key (run_id)
    references workout_runs(id) on delete restrict,
  constraint rewards_workout_session_fk foreign key (workout_session_id)
    references workout_sessions(id) on delete restrict
);
create unique index rewards_one_per_run_idx
  on rewards (run_id) where run_id is not null;
create unique index rewards_one_workout_per_session_day_idx
  on rewards (member_id, workout_session_id, reward_day)
  where workout_session_id is not null and reward_day is not null;

-- Written when a professional scans a member's QR access badge.
create table checkins (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references profiles(id) on delete cascade,
  scanned_by_id uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index on checkins (member_id, created_at desc);

-- Short-lived member badge. Only redeem_checkin_token() may consume it.
create table checkin_tokens (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null default now() + interval '60 seconds',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index checkin_tokens_member_expires_idx
  on checkin_tokens (member_id, expires_at desc);

-- Body measurements taken by the professional during a check-in.  One reading
-- per client per day; the unique pair is also the upsert target, which makes a
-- replayed offline save idempotent.
create table body_metrics (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references profiles(id) on delete cascade,
  recorded_by_id uuid references profiles(id) on delete set null,
  measured_on    date not null,
  weight_kg      numeric(5,2),
  note           text,
  created_at     timestamptz not null default now(),
  unique (member_id, measured_on)
);
create index on body_metrics (member_id, measured_on desc);

create table push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index on push_subscriptions (user_id);

-- Private database-to-Edge-Function configuration. RLS is enabled in
-- policies.sql with deliberately no policies; patch 010 also revokes grants.
create table app_config (
  key   text primary key,
  value text not null
);

-- Supabase creates the auth user; this mirrors it into `profiles` so the app
-- never has to deal with a signed-in user that has no profile row.
-- `search_path = ''` with everything qualified, not `= public`: pg_temp is
-- resolved before search_path, so an unqualified `profiles` in a
-- `security definer` function is shadowable by any role that can create a temp
-- table.  See `patches/011`, which repairs databases created before this fix.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'member'::public.user_role
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
