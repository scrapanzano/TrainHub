-- TrainHub demo data.
--
-- ============================================================================
-- THIS FILE IS DESTRUCTIVE. It deletes every demo row in the database and
-- rebuilds it.
--
-- It never DELETES from `auth.users`, `profiles` or `exercises`, so the
-- accounts and their uuids survive any number of re-runs. It does write to all
-- three: profiles are upserted, the exercise catalogue is topped up, and
-- `auth.users` gains the five members who never sign in.
-- ============================================================================
--
-- Run it in the Supabase SQL editor AFTER schema.sql, policies.sql and every
-- patch 001-025. See INSTALL.md for the full order and for the four auth users
-- that must exist first.
--
-- RE-RUNNABLE, AND MEANT TO BE RE-RUN. Session state is DERIVED from the
-- workout runs inside the current ISO week (`runStatusOf` in src/lib/week.js),
-- so a seed frozen at one date ages into an app where every session reads
-- "To Do" and every progress bar is empty. Everything below is anchored to
-- `date_trunc('week', current_date)`, which is the same Monday `mondayOf()`
-- computes in the browser. Re-run this before a demo and the data is current
-- again. It replaces `patches/002-rebase-demo-agenda.sql`, which did the same
-- thing for appointments alone.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS ONE ENORMOUS `DO` BLOCK
--
-- Because the Supabase SQL editor does not give a multi-statement script a
-- stable session. Two earlier versions of this file died on that, in two
-- different ways: a `create temp table ... on commit drop` was gone by the time
-- a later statement read it, and then a plain `create temp table` was gone too.
-- Whatever the editor is doing between statements -- committing each one,
-- handing them to different pooled backends, or both -- temporary objects do
-- not survive it, and neither do `pg_temp` helper functions.
--
-- A single statement cannot be split, cannot lose session state, and is atomic.
-- So the reset, the rebuild and the push-configuration parking all live in one
-- `DO` block, and the file contains exactly two statements: this block, and a
-- read-only summary at the end. If the block raises, nothing is written at all
-- and the database is exactly as it was.
--
-- The cost is that the helper logic is inlined and driven by data instead of
-- being five small functions. Runs, check-ins, plans and nutrition plans are
-- each built as a `jsonb` list of what to create and then executed by one loop,
-- which is why the call sites below read as data rather than as code.
-- ---------------------------------------------------------------------------
--
-- WHAT "VALID" MEANS HERE. Every row is a row the application itself could have
-- written. The secure RPCs cannot be called from the SQL editor -- they all read
-- `auth.uid()`, which is null here -- so the inserts are direct, but each one
-- respects the rule its RPC would have enforced. The three that have
-- historically been got wrong:
--
--   * a workout session ALWAYS carries at least one prescribed exercise.
--     `_insert_session_bundle` (patches/015) raises 22023 otherwise, and a
--     session with no exercises makes every run on it score 0%.
--   * `workout_runs.pct`, `outcome` and the reward points are never typed by
--     hand. They are recomputed below with the same expressions as
--     `close_workout_run_secure` (patches/023).
--   * `rewards.code` only ever takes the two shapes the app generates:
--     `workout:<run id>` and `checkin:<date>`.
--
-- `verify.sql` checks all of this after the fact rather than taking it on trust.
--
-- `workout_sessions.status` is deliberately NOT written. Since Phase 5A nothing
-- reads it and nothing writes it; it survives in the schema for old rows only.
--
-- Every local is `v_`-prefixed on purpose. PL/pgSQL defaults
-- `plpgsql.variable_conflict` to `error`, so a variable sharing a name with a
-- column in scope -- `plan_id`, `member_id`, `pro_id` all exist as columns
-- here -- aborts the block with "column reference is ambiguous".

do $seed$
declare
  -- The Monday of the current ISO week. `date_trunc('week', ...)` is Monday in
  -- Postgres, which is the same day `mondayOf()` computes in the browser --
  -- that agreement is what makes the derived session states land in the week
  -- the member is actually looking at.
  v_monday date := date_trunc('week', current_date)::date;

  v_marco      uuid;
  v_giulia     uuid;
  v_daniel     uuid;
  v_sofia      uuid;
  v_elena      uuid;
  v_lorenzo    uuid;
  v_alex       uuid;
  v_pierfelice uuid;
  v_chiara     uuid;

  -- Plans are created by one loop over a spec list, so their ids come back in
  -- an array and are given names afterwards.
  v_plan_ids     uuid[] := '{}';
  v_plan_daniel  uuid;
  v_plan_elena_a uuid;
  v_plan_elena_b uuid;
  v_plan_lorenzo uuid;
  v_plan_alex    uuid;
  v_plan_pier    uuid;
  v_plan_sofia   uuid;

  -- The work lists. Built first, executed by a single loop each.
  v_runs     jsonb := '[]'::jsonb;
  v_checkins jsonb := '[]'::jsonb;
  -- name -> uuid, so the spec lists can stay readable literals.
  v_people   jsonb;

  v_spec       jsonb;
  v_session    jsonb;
  v_item       jsonb;
  v_day        jsonb;
  v_meal       jsonb;

  v_plan_id    uuid;
  v_session_id uuid;
  v_day_id     uuid;
  v_exercise   uuid;
  v_run        uuid;
  v_thread     uuid;

  v_target  int;
  v_name    text;
  v_quota   int;
  v_take    int;
  v_done    int;
  v_pct     int;
  v_points  int;
  v_outcome public.run_outcome;
  v_started timestamptz;
  v_ended   timestamptz;
  v_rday    date;

  v_col   text;
  v_count int;
  v_w     int;
  v_i     int;
  r       record;
begin
  -- =========================================================================
  -- 0. Silence the push fan-out for the duration of the seed.
  --
  -- Inserting messages, appointments and plans fires the notification triggers
  -- from patches/020 -- which is exactly what we want, because it is how the
  -- notification rows get created honestly. But `notify_user()` also calls
  -- `net.http_post` when `app_config` carries the Edge Function's URL and
  -- secret, so seeding would fire fifty-odd real web pushes at whatever devices
  -- are subscribed. `notify_user` returns early when either key is missing, and
  -- still writes the notification row, so hiding them is enough.
  --
  -- Renamed in place rather than copied somewhere. Inside one `DO` block this
  -- is also transactional: if anything below raises, the rename is rolled back
  -- with everything else and the configuration is untouched.
  -- =========================================================================
  update public.app_config
  set key = 'parked:' || key
  where key in ('notify_function_url', 'notify_secret');

  -- =========================================================================
  -- 1. Reset.
  --
  -- Every row in this database is demo content, so the reset is total. The
  -- order is dictated by the `on delete restrict` foreign keys, which do not
  -- cascade: `rewards.run_id` and `rewards.workout_session_id` pin runs and
  -- sessions, and `replaces_plan_id` pins the older plan in a chain. Children
  -- first.
  --
  -- `exercises` is NOT deleted: `session_exercises.exercise_id` is
  -- `on delete restrict`, and the catalogue is content rather than demo state.
  -- `profiles` and `auth.users` are NOT deleted either -- they are upserted
  -- below, so the accounts and their uuids survive a re-run.
  -- =========================================================================
  delete from public.rewards;
  delete from public.set_logs;
  delete from public.workout_runs;
  -- Two passes: a chained plan's newer half must go before the half it
  -- replaces. Chains in this file are at most two long, which is what makes two
  -- passes enough.
  delete from public.workout_plans where replaces_plan_id is not null;
  delete from public.workout_plans;
  delete from public.meals;
  delete from public.nutrition_days;
  delete from public.nutrition_plans where replaces_plan_id is not null;
  delete from public.nutrition_plans;
  delete from public.appointments;
  delete from public.messages;
  delete from public.threads;
  delete from public.checkins;
  delete from public.checkin_tokens;
  delete from public.body_metrics;
  delete from public.notifications;
  delete from public.availability;

  -- =========================================================================
  -- 2. The five demo clients who never sign in.
  --
  -- No `auth.identities` row is created, so there is no credential to log in
  -- with, and the empty `encrypted_password` matches nothing bcrypt can
  -- produce.
  --
  -- The four created by `patches/005-demo-clients.sql` are on the old
  -- `@trainhub.dev` domain. They carry no identity row, so their address is
  -- ordinary data and renaming it here is safe -- unlike the accounts that DO
  -- sign in, which must be renamed from the dashboard so GoTrue's own tables
  -- stay consistent. See INSTALL.md.
  -- =========================================================================
  update auth.users
  set email = replace(email, '@trainhub.dev', '@trainhub.com'),
      updated_at = now()
  where email in ('elena@trainhub.dev', 'lorenzo@trainhub.dev',
                  'alex@trainhub.dev', 'pierfelice@trainhub.dev')
    -- Guarded: renaming onto an address that already exists would collide with
    -- the partial unique index on `auth.users.email`. Leaves the stale row
    -- alone instead, and `verify.sql` reports the extra profile.
    and not exists (
      select 1 from auth.users taken
      where taken.email = replace(auth.users.email, '@trainhub.dev', '@trainhub.com')
    );

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data
  )
  select
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated',
    'authenticated',
    t.email,
    '',
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', t.full_name, 'role', 'member')
  from (values
    ('elena@trainhub.com',      'Elena Mingotti'),
    ('lorenzo@trainhub.com',    'Lorenzo Mamone'),
    ('alex@trainhub.com',       'Alex Giustacchini'),
    ('pierfelice@trainhub.com', 'Pierfelice Rocco'),
    ('chiara@trainhub.com',     'Chiara Neri')
  ) as t(email, full_name)
  -- `auth.users` unique-indexes email only partially (`where is_sso_user =
  -- false`), so `on conflict (email)` would not match it. Guard explicitly.
  where not exists (select 1 from auth.users u where u.email = t.email);

  -- GoTrue cannot read a user whose token columns are NULL.
  --
  -- Four of them -- confirmation_token, recovery_token, email_change_token_new,
  -- email_change -- have no DEFAULT in the auth schema, so an INSERT that omits
  -- them leaves NULL. GoTrue scans those into plain Go `string` fields, a NULL
  -- scan fails, and the whole request dies as `Database error loading user`.
  -- The practical symptom is that Authentication -> Users can neither open NOR
  -- DELETE the rows -- which is the state `patches/005` left the project in.
  --
  -- Guarded by column existence rather than written as a flat UPDATE: the list
  -- has been stable in GoTrue for years, but naming a column a future release
  -- has dropped would abort the whole seed, and this is the file that always
  -- runs. Only NULLs are touched, so a genuinely pending token is left alone.
  foreach v_col in array array[
    'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_new', 'email_change_token_current',
    'phone_change', 'phone_change_token', 'reauthentication_token'
  ]
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users'
        and column_name = v_col
    ) then
      execute format(
        'update auth.users set %I = %L where %I is null', v_col, '', v_col);
    end if;
  end loop;

  -- =========================================================================
  -- 3. The cast.
  -- =========================================================================
  -- The four accounts that sign in are created by hand, so the seed can only
  -- look them up. Failing loudly here beats a foreign key violation forty
  -- statements later that names a uuid instead of an address.
  select id into v_marco  from auth.users where email = 'marco@trainhub.com';
  select id into v_giulia from auth.users where email = 'giulia@trainhub.com';
  select id into v_daniel from auth.users where email = 'daniel@trainhub.com';
  select id into v_sofia  from auth.users where email = 'sofia@trainhub.com';

  if v_marco is null then
    raise exception 'Missing auth user marco@trainhub.com. Create it from the dashboard with Auto Confirm User ticked, or rename the legacy andrea@trainhub.dev account -- see INSTALL.md.';
  end if;
  if v_daniel is null then
    raise exception 'Missing auth user daniel@trainhub.com. Create it from the dashboard with Auto Confirm User ticked, or rename the legacy daniel@trainhub.dev account -- see INSTALL.md.';
  end if;
  if v_giulia is null then
    raise exception 'Missing auth user giulia@trainhub.com. Create it from the dashboard with Auto Confirm User ticked -- see INSTALL.md.';
  end if;
  if v_sofia is null then
    raise exception 'Missing auth user sofia@trainhub.com. Create it from the dashboard with Auto Confirm User ticked -- see INSTALL.md.';
  end if;

  select id into v_elena      from auth.users where email = 'elena@trainhub.com';
  select id into v_lorenzo    from auth.users where email = 'lorenzo@trainhub.com';
  select id into v_alex       from auth.users where email = 'alex@trainhub.com';
  select id into v_pierfelice from auth.users where email = 'pierfelice@trainhub.com';
  select id into v_chiara     from auth.users where email = 'chiara@trainhub.com';

  -- Upsert rather than update. `on_auth_user_created` normally creates these
  -- rows -- and since patches/015 it always creates them as MEMBERS, whatever
  -- the browser claimed in its metadata, so promoting the two professionals is
  -- this file's job. A plain UPDATE against a missing row succeeds silently at
  -- zero rows and the failure would surface much later as a foreign key
  -- violation.
  --
  -- The professionals go first: every member references one via
  -- `assigned_pro_id`, and `validate_profile_authority` (patches/015) rejects
  -- an assignment that does not already point at a professional.
  -- `assigned_pro_id` is stated as null for them because the same trigger
  -- refuses a professional who is assigned to another professional.
  insert into public.profiles (
    id, role, specialty, full_name, bio, assigned_pro_id,
    subscription_status, subscription_until
  ) values
    (v_marco, 'professional', 'both', 'Marco Ferrari',
     'Strength coach and nutritionist. Twelve years on the gym floor.',
     null, 'active', null),
    (v_giulia, 'professional', 'both', 'Giulia Ricci',
     'Sports nutritionist. Builds plans people can actually keep to.',
     null, 'active', null)
  on conflict (id) do update set
    role = excluded.role, specialty = excluded.specialty,
    full_name = excluded.full_name, bio = excluded.bio,
    assigned_pro_id = excluded.assigned_pro_id,
    subscription_status = excluded.subscription_status,
    subscription_until = excluded.subscription_until;

  -- The membership matrix is the point of this list: ordinary active members,
  -- one whose subscription lapses in under a fortnight, one suspended and one
  -- expired. `has_active_subscription` (patches/023) reads all four
  -- differently, and so do the badge, the booking flow and the reward writes.
  for r in
    select * from (values
      (v_daniel,     'Daniel Aresta',     v_marco,  'active',    (current_date + interval '8 months')::date),
      (v_sofia,      'Sofia Bianchi',     v_giulia, 'active',    (current_date + interval '5 months')::date),
      (v_elena,      'Elena Mingotti',    v_marco,  'active',    (current_date + interval '6 months')::date),
      (v_lorenzo,    'Lorenzo Mamone',    v_marco,  'active',    (current_date + interval '12 days')::date),
      (v_alex,       'Alex Giustacchini', v_marco,  'suspended', (current_date + interval '3 months')::date),
      (v_pierfelice, 'Pierfelice Rocco',  v_marco,  'expired',   (current_date - interval '2 weeks')::date),
      (v_chiara,     'Chiara Neri',       v_giulia, 'active',    (current_date + interval '4 months')::date)
    ) as t(uid, display_name, coach, sub_status, sub_until)
  loop
    insert into public.profiles (
      id, role, specialty, full_name, assigned_pro_id,
      subscription_status, subscription_until
    ) values (
      r.uid, 'member', null, r.display_name, r.coach,
      r.sub_status::public.subscription_status, r.sub_until
    )
    on conflict (id) do update set
      role = excluded.role, specialty = excluded.specialty,
      full_name = excluded.full_name,
      assigned_pro_id = excluded.assigned_pro_id,
      subscription_status = excluded.subscription_status,
      subscription_until = excluded.subscription_until;
  end loop;

  -- =========================================================================
  -- 4. Exercise catalogue.
  --
  -- Content, not demo state: never deleted by the reset above, because
  -- `session_exercises.exercise_id` is `on delete restrict`. Repeated here in
  -- full so a fresh install needs only this file, and guarded so a database
  -- that already ran `patches/019` is unchanged.
  -- =========================================================================
  insert into public.exercises (name, muscle_group, equipment, instructions) values
    ('Bench Press',      'Chest',      'Barbell',   'Lower to mid-chest, press to full extension.'),
    ('Incline Dumbbell Press', 'Chest', 'Dumbbell', 'Bench at 30 degrees. Control the descent.'),
    ('Cable Fly',        'Chest',      'Cable',     'Slight elbow bend held throughout.'),
    ('Back Squat',       'Legs',       'Barbell',   'Break at the hips, knees tracking over toes.'),
    ('Romanian Deadlift','Legs',       'Barbell',   'Hinge at the hips, keep the bar close.'),
    ('Leg Press',        'Legs',       'Machine',   'Do not lock the knees at the top.'),
    ('Pull-up',          'Back',       'Bodyweight','Full hang to chin over the bar.'),
    ('Barbell Row',      'Back',       'Barbell',   'Torso near 45 degrees, pull to the navel.'),
    ('Overhead Press',   'Shoulders',  'Barbell',   'Brace the core, press in a straight line.'),
    ('Lateral Raise',    'Shoulders',  'Dumbbell',  'Lead with the elbows, stop at shoulder height.'),
    ('Barbell Curl',        'Biceps',  'Barbell',   'Elbows pinned to the ribs, no swing.'),
    ('Hammer Curl',         'Biceps',  'Dumbbell',  'Neutral grip throughout, control the descent.'),
    ('Incline Dumbbell Curl','Biceps', 'Dumbbell',  'Bench at 45 degrees for a deep stretch.'),
    ('Cable Curl',          'Biceps',  'Cable',     'Constant tension, stop short of lockout.'),
    ('Tricep Pushdown',     'Triceps', 'Cable',     'Elbows fixed at the sides, full extension.'),
    ('Skull Crusher',       'Triceps', 'Barbell',   'Lower to the forehead, elbows stay narrow.'),
    ('Overhead Tricep Extension', 'Triceps', 'Dumbbell', 'Elbows close to the head, full stretch.'),
    ('Close-Grip Bench Press', 'Triceps', 'Barbell', 'Hands shoulder-width, elbows tucked.'),
    ('Plank',               'Core',    'Bodyweight','Straight line from shoulders to heels.'),
    ('Hanging Leg Raise',   'Core',    'Bodyweight','Curl the pelvis, avoid swinging.'),
    ('Cable Crunch',        'Core',    'Cable',     'Round the spine, hips stay still.'),
    ('Russian Twist',       'Core',    'Bodyweight','Rotate from the torso, feet may stay down.')
  on conflict (name) do nothing;

  -- =========================================================================
  -- 5. Availability.
  --
  -- Weekday 0 = Sunday, matching the column's check constraint and the booking
  -- screen. Marco keeps gym hours; Giulia consults two afternoons and a
  -- Saturday morning, so the booking grid is visibly different per coach.
  -- =========================================================================
  insert into public.availability (pro_id, weekday, starts_at, ends_at)
  select v_marco, d, '09:00', '13:00' from generate_series(1, 5) d;
  insert into public.availability (pro_id, weekday, starts_at, ends_at)
  select v_marco, d, '14:00', '19:00' from generate_series(1, 5) d;
  insert into public.availability (pro_id, weekday, starts_at, ends_at) values
    (v_giulia, 2, '10:00', '14:00'),
    (v_giulia, 4, '10:00', '14:00'),
    (v_giulia, 6, '09:00', '12:00');

  -- People by name, so the spec lists below can stay readable literals instead
  -- of uuid variables spliced into JSON.
  v_people := jsonb_build_object(
    'marco', v_marco, 'giulia', v_giulia, 'daniel', v_daniel, 'sofia', v_sofia,
    'elena', v_elena, 'lorenzo', v_lorenzo, 'alex', v_alex,
    'pierfelice', v_pierfelice, 'chiara', v_chiara);

  -- =========================================================================
  -- 6. Workout plans.
  --
  -- One loop over a spec list, so the two rules `create_workout_plan_secure`
  -- and `_insert_session_bundle` enforce are written once: a plan needs at
  -- least one session, and a session needs at least one prescribed exercise.
  -- Seeding a session with no exercises is the single defect this whole file
  -- exists to stop -- it makes every run on that session score 0% forever.
  --
  -- `replaces_index` is a 1-based index into this same list, which is what lets
  -- Elena's Phase 2 point at her Phase 1 without either uuid being known in
  -- advance. `workout_plans_replaced_once_idx` allows it exactly once per plan.
  --
  -- Exercises are named rather than keyed by uuid; the name is `unique` in the
  -- catalogue, which is what makes that safe.
  --
  -- Every plan predates every run on it, and `expires_on` is derived from
  -- `weeks`, so a plan that is still current has a date in the future.
  -- =========================================================================
  for v_spec in select * from jsonb_array_elements($plans$[
    {"member": "daniel", "author": "marco", "created_days_before": 42,
     "name": "Hypertrophy - Phase 2", "goal": "Hypertrophy", "level": "Intermediate", "weeks": 12,
     "sessions": [
      {"name": "Chest & Triceps", "position": 1, "exercises": [
        {"exercise": "Bench Press",            "position": 1, "sets": 4, "reps": 10, "weight": 60, "rest": 120},
        {"exercise": "Incline Dumbbell Press", "position": 2, "sets": 3, "reps": 12, "weight": 24},
        {"exercise": "Cable Fly",              "position": 3, "sets": 3, "reps": 15, "weight": 15, "rest": 60},
        {"exercise": "Tricep Pushdown",        "position": 4, "sets": 3, "reps": 12, "weight": 25, "rest": 60}
      ]},
      {"name": "Legs", "position": 2, "exercises": [
        {"exercise": "Back Squat",        "position": 1, "sets": 4, "reps": 8,  "weight": 80, "rest": 150},
        {"exercise": "Romanian Deadlift", "position": 2, "sets": 3, "reps": 10, "weight": 60, "rest": 120},
        {"exercise": "Leg Press",         "position": 3, "sets": 3, "reps": 12, "weight": 120}
      ]},
      {"name": "Back & Biceps", "position": 3, "exercises": [
        {"exercise": "Pull-up",      "position": 1, "sets": 4, "reps": 8,  "rest": 120},
        {"exercise": "Barbell Row",  "position": 2, "sets": 4, "reps": 10, "weight": 50, "rest": 120},
        {"exercise": "Barbell Curl", "position": 3, "sets": 3, "reps": 12, "weight": 25, "rest": 60},
        {"exercise": "Hammer Curl",  "position": 4, "sets": 3, "reps": 12, "weight": 14, "rest": 60}
      ]},
      {"name": "Shoulders & Core", "position": 4, "exercises": [
        {"exercise": "Overhead Press",    "position": 1, "sets": 4, "reps": 8,  "weight": 40, "rest": 120},
        {"exercise": "Lateral Raise",     "position": 2, "sets": 3, "reps": 15, "weight": 10, "rest": 60},
        {"exercise": "Hanging Leg Raise", "position": 3, "sets": 3, "reps": 12, "rest": 60},
        {"exercise": "Cable Crunch",      "position": 4, "sets": 3, "reps": 15, "weight": 30, "rest": 60}
      ]}
     ]},

    {"member": "elena", "author": "marco", "created_days_before": 70,
     "name": "Weight Loss - Phase 1", "goal": "Weight Loss", "level": "Intermediate", "weeks": 6,
     "sessions": [
      {"name": "Full Body A", "position": 1, "exercises": [
        {"exercise": "Back Squat",    "position": 1, "sets": 3, "reps": 12, "weight": 40},
        {"exercise": "Barbell Row",   "position": 2, "sets": 3, "reps": 12, "weight": 30},
        {"exercise": "Overhead Press","position": 3, "sets": 3, "reps": 12, "weight": 20}
      ]},
      {"name": "Full Body B", "position": 2, "exercises": [
        {"exercise": "Romanian Deadlift",      "position": 1, "sets": 3, "reps": 12, "weight": 35},
        {"exercise": "Incline Dumbbell Press", "position": 2, "sets": 3, "reps": 12, "weight": 12},
        {"exercise": "Lateral Raise",          "position": 3, "sets": 3, "reps": 15, "weight": 6}
      ]}
     ]},

    {"member": "elena", "author": "marco", "created_days_before": 21, "replaces_index": 2,
     "name": "Weight Loss - Phase 2", "goal": "Weight Loss", "level": "Intermediate", "weeks": 8,
     "sessions": [
      {"name": "Upper Body", "position": 1, "exercises": [
        {"exercise": "Incline Dumbbell Press", "position": 1, "sets": 4, "reps": 10, "weight": 14},
        {"exercise": "Barbell Row",            "position": 2, "sets": 4, "reps": 10, "weight": 35},
        {"exercise": "Lateral Raise",          "position": 3, "sets": 3, "reps": 15, "weight": 7},
        {"exercise": "Cable Curl",             "position": 4, "sets": 3, "reps": 12, "weight": 15}
      ]},
      {"name": "Lower Body", "position": 2, "exercises": [
        {"exercise": "Back Squat",        "position": 1, "sets": 4, "reps": 10, "weight": 45},
        {"exercise": "Romanian Deadlift", "position": 2, "sets": 3, "reps": 12, "weight": 40},
        {"exercise": "Leg Press",         "position": 3, "sets": 3, "reps": 15, "weight": 90}
      ]},
      {"name": "Core", "position": 3, "exercises": [
        {"exercise": "Cable Crunch",      "position": 1, "sets": 4, "reps": 15, "weight": 25},
        {"exercise": "Hanging Leg Raise", "position": 2, "sets": 3, "reps": 12},
        {"exercise": "Russian Twist",     "position": 3, "sets": 3, "reps": 20}
      ]}
     ]},

    {"member": "lorenzo", "author": "marco", "created_days_before": 28,
     "name": "Hypertrophy - Phase 1", "goal": "Hypertrophy", "level": "Beginner", "weeks": 8,
     "sessions": [
      {"name": "Push", "position": 1, "exercises": [
        {"exercise": "Bench Press",     "position": 1, "sets": 4, "reps": 10, "weight": 45},
        {"exercise": "Overhead Press",  "position": 2, "sets": 3, "reps": 10, "weight": 25},
        {"exercise": "Tricep Pushdown", "position": 3, "sets": 3, "reps": 12, "weight": 20}
      ]},
      {"name": "Pull", "position": 2, "exercises": [
        {"exercise": "Barbell Row",  "position": 1, "sets": 4, "reps": 10, "weight": 40},
        {"exercise": "Pull-up",      "position": 2, "sets": 3, "reps": 6},
        {"exercise": "Barbell Curl", "position": 3, "sets": 3, "reps": 12, "weight": 20}
      ]},
      {"name": "Legs", "position": 3, "exercises": [
        {"exercise": "Back Squat",        "position": 1, "sets": 4, "reps": 10, "weight": 60},
        {"exercise": "Leg Press",         "position": 2, "sets": 3, "reps": 12, "weight": 100},
        {"exercise": "Romanian Deadlift", "position": 3, "sets": 3, "reps": 10, "weight": 45}
      ]}
     ]},

    {"member": "alex", "author": "marco", "created_days_before": 42,
     "name": "Strength - Phase 1", "goal": "Strength", "level": "Advanced", "weeks": 8,
     "sessions": [
      {"name": "Squat Day", "position": 1, "exercises": [
        {"exercise": "Back Squat",   "position": 1, "sets": 5, "reps": 5,  "weight": 100, "rest": 180},
        {"exercise": "Leg Press",    "position": 2, "sets": 3, "reps": 8,  "weight": 140},
        {"exercise": "Cable Crunch", "position": 3, "sets": 3, "reps": 15, "weight": 30}
      ]},
      {"name": "Bench Day", "position": 2, "exercises": [
        {"exercise": "Bench Press",            "position": 1, "sets": 5, "reps": 5,  "weight": 85, "rest": 180},
        {"exercise": "Close-Grip Bench Press", "position": 2, "sets": 3, "reps": 8,  "weight": 65},
        {"exercise": "Skull Crusher",          "position": 3, "sets": 3, "reps": 10, "weight": 30}
      ]},
      {"name": "Pull Day", "position": 3, "exercises": [
        {"exercise": "Barbell Row",  "position": 1, "sets": 5, "reps": 5,  "weight": 70, "rest": 180},
        {"exercise": "Pull-up",      "position": 2, "sets": 4, "reps": 6},
        {"exercise": "Barbell Curl", "position": 3, "sets": 3, "reps": 10, "weight": 30}
      ]}
     ]},

    {"member": "pierfelice", "author": "marco", "created_days_before": 56,
     "name": "Conditioning - Phase 1", "goal": "Conditioning", "level": "Beginner", "weeks": 6,
     "sessions": [
      {"name": "Circuit A", "position": 1, "exercises": [
        {"exercise": "Leg Press",     "position": 1, "sets": 3, "reps": 15, "weight": 60, "rest": 45},
        {"exercise": "Cable Fly",     "position": 2, "sets": 3, "reps": 15, "weight": 10, "rest": 45},
        {"exercise": "Russian Twist", "position": 3, "sets": 3, "reps": 20, "rest": 45}
      ]},
      {"name": "Circuit B", "position": 2, "exercises": [
        {"exercise": "Hammer Curl",       "position": 1, "sets": 3, "reps": 15, "weight": 10, "rest": 45},
        {"exercise": "Tricep Pushdown",   "position": 2, "sets": 3, "reps": 15, "weight": 15, "rest": 45},
        {"exercise": "Hanging Leg Raise", "position": 3, "sets": 3, "reps": 12, "rest": 45}
      ]}
     ]},

    {"member": "sofia", "author": "sofia", "created_days_before": 14,
     "name": "My Full Body Routine", "goal": "General Fitness", "level": "Beginner", "weeks": 8,
     "sessions": [
      {"name": "Full Body A", "position": 1, "exercises": [
        {"exercise": "Back Squat",             "position": 1, "sets": 3, "reps": 10, "weight": 30},
        {"exercise": "Incline Dumbbell Press", "position": 2, "sets": 3, "reps": 10, "weight": 10},
        {"exercise": "Barbell Row",            "position": 3, "sets": 3, "reps": 10, "weight": 25}
      ]},
      {"name": "Full Body B", "position": 2, "exercises": [
        {"exercise": "Romanian Deadlift", "position": 1, "sets": 3, "reps": 10, "weight": 30},
        {"exercise": "Overhead Press",    "position": 2, "sets": 3, "reps": 10, "weight": 15},
        {"exercise": "Cable Curl",        "position": 3, "sets": 3, "reps": 12, "weight": 12}
      ]},
      {"name": "Core", "position": 3, "exercises": [
        {"exercise": "Cable Crunch",      "position": 1, "sets": 3, "reps": 15, "weight": 20},
        {"exercise": "Russian Twist",     "position": 2, "sets": 3, "reps": 20},
        {"exercise": "Hanging Leg Raise", "position": 3, "sets": 3, "reps": 10}
      ]}
     ]}
  ]$plans$::jsonb)
  loop
    if coalesce(jsonb_array_length(v_spec->'sessions'), 0) = 0 then
      raise exception 'seed: plan "%" has no sessions', v_spec->>'name';
    end if;

    v_plan_id := gen_random_uuid();
    v_started := (v_monday - (v_spec->>'created_days_before')::int) + time '09:00';

    insert into public.workout_plans (
      id, member_id, author_id, name, goal, level, weeks, expires_on,
      replaces_plan_id, created_at
    ) values (
      v_plan_id,
      (v_people->>(v_spec->>'member'))::uuid,
      (v_people->>(v_spec->>'author'))::uuid,
      v_spec->>'name', v_spec->>'goal', v_spec->>'level',
      (v_spec->>'weeks')::int,
      (v_started + make_interval(weeks => (v_spec->>'weeks')::int))::date,
      v_plan_ids[(v_spec->>'replaces_index')::int],
      v_started
    );

    for v_session in select * from jsonb_array_elements(v_spec->'sessions')
    loop
      v_session_id := gen_random_uuid();

      -- `status` is deliberately absent: since Phase 5A it is derived from the
      -- runs of the current ISO week and nothing writes the column.
      insert into public.workout_sessions (id, plan_id, name, position)
      values (v_session_id, v_plan_id, v_session->>'name',
              (v_session->>'position')::int);

      v_count := 0;
      for v_item in select * from jsonb_array_elements(v_session->'exercises')
      loop
        select id into v_exercise from public.exercises
        where name = v_item->>'exercise';
        if v_exercise is null then
          raise exception 'seed: no catalogue exercise named %',
            v_item->>'exercise';
        end if;

        insert into public.session_exercises (
          id, session_id, exercise_id, position,
          target_sets, target_reps, target_weight, rest_seconds
        ) values (
          gen_random_uuid(), v_session_id, v_exercise,
          (v_item->>'position')::int,
          (v_item->>'sets')::int, (v_item->>'reps')::int,
          (v_item->>'weight')::numeric,
          coalesce((v_item->>'rest')::int, 90)
        );
        v_count := v_count + 1;
      end loop;

      if v_count = 0 then
        raise exception 'seed: session "%" has no exercises', v_session->>'name';
      end if;
    end loop;

    v_plan_ids := v_plan_ids || v_plan_id;
  end loop;

  -- Named, in the order of the list above, so the run specs can refer to them.
  v_plan_daniel  := v_plan_ids[1];
  v_plan_elena_a := v_plan_ids[2];
  v_plan_elena_b := v_plan_ids[3];
  v_plan_lorenzo := v_plan_ids[4];
  v_plan_alex    := v_plan_ids[5];
  v_plan_pier    := v_plan_ids[6];
  v_plan_sofia   := v_plan_ids[7];

  -- Chiara deliberately has no workout plan: the empty state on a real client's
  -- dossier, which is otherwise only reachable by creating an account mid-demo.

  -- =========================================================================
  -- 7. What everybody trained, as a work list.
  --
  -- Built first, executed by the single loop in section 8. Anchored to the
  -- current ISO week, because that is the only week the session cards read.
  --
  -- `fraction` is the share of the PRESCRIBED sets that got logged. Section 8
  -- spends it in prescription order -- the member does the first exercise in
  -- full, then the second, and stops when they stop. That is what a partial
  -- workout looks like; spreading the shortfall evenly across every exercise is
  -- not.
  -- =========================================================================

  -- Daniel. Five earlier weeks is not an arbitrary depth: it is what guarantees
  -- the history crosses a calendar month boundary whatever day the seed runs,
  -- so `groupByMonth` on the rewards screen renders more than one group.
  for v_w in 1 .. 5 loop
    v_runs := v_runs
      || jsonb_build_object(
           'member', v_daniel,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_daniel and position = 1),
           'start', (v_monday - v_w * 7) + time '18:00',
           'minutes', 62, 'fraction', 1.0)
      || jsonb_build_object(
           'member', v_daniel,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_daniel and position = 2),
           'start', (v_monday - v_w * 7 + 2) + time '18:30',
           'minutes', 58,
           'fraction', case when v_w % 3 = 0 then 0.6 else 1.0 end)
      || jsonb_build_object(
           'member', v_daniel,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_daniel and position = 3),
           'start', (v_monday - v_w * 7 + 4) + time '18:00',
           'minutes', 65,
           'fraction', case when v_w % 2 = 0 then 0.8 else 1.0 end);

    if v_w % 2 = 1 then
      v_runs := v_runs || jsonb_build_object(
        'member', v_daniel,
        'session', (select id from public.workout_sessions
                    where plan_id = v_plan_daniel and position = 4),
        'start', (v_monday - v_w * 7 + 5) + time '10:00',
        'minutes', 55, 'fraction', 1.0);
    end if;
  end loop;

  -- The current week. `greatest(v_monday, current_date - n)` keeps these inside
  -- this ISO week however far into it the seed runs: re-seed on a Wednesday and
  -- they land on Monday and Tuesday, re-seed on a Monday and they collapse onto
  -- today at 08:00 and 12:30.
  --
  -- ponytail: on a Monday-morning demo those two times have not happened yet.
  -- Harmless -- nothing reads a run's start against the clock -- and the
  -- alternative is a Monday on which three of the four session states cannot be
  -- shown at all.
  v_runs := v_runs
    || jsonb_build_object(
         'member', v_daniel,
         'session', (select id from public.workout_sessions
                     where plan_id = v_plan_daniel and position = 1),
         'start', greatest(v_monday, current_date - 2) + time '08:00',
         'minutes', 62, 'fraction', 1.0)
    || jsonb_build_object(
         'member', v_daniel,
         'session', (select id from public.workout_sessions
                     where plan_id = v_plan_daniel and position = 2),
         'start', greatest(v_monday, current_date - 1) + time '12:30',
         'minutes', 58, 'fraction', 0.6,
         'note', 'Lower back tight again. Stopped after the leg press.');

  -- Elena: six weeks on Phase 1, then Phase 2 from three weeks ago. The gap in
  -- the middle is the plan change itself.
  for v_w in 4 .. 9 loop
    v_runs := v_runs
      || jsonb_build_object(
           'member', v_elena,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_elena_a and position = 1),
           'start', (v_monday - v_w * 7 + 1) + time '09:00',
           'minutes', 55, 'fraction', 1.0)
      || jsonb_build_object(
           'member', v_elena,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_elena_a and position = 2),
           'start', (v_monday - v_w * 7 + 3) + time '09:00',
           'minutes', 55,
           'fraction', case when v_w % 2 = 0 then 0.7 else 1.0 end);
  end loop;

  for v_w in 1 .. 3 loop
    v_runs := v_runs
      || jsonb_build_object(
           'member', v_elena,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_elena_b and position = 1),
           'start', (v_monday - v_w * 7 + 1) + time '09:30',
           'minutes', 60, 'fraction', 1.0)
      || jsonb_build_object(
           'member', v_elena,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_elena_b and position = 2),
           'start', (v_monday - v_w * 7 + 3) + time '09:30',
           'minutes', 58, 'fraction', 1.0)
      || jsonb_build_object(
           'member', v_elena,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_elena_b and position = 3),
           'start', (v_monday - v_w * 7 + 5) + time '10:00',
           'minutes', 40,
           'fraction', case when v_w = 2 then 0.5 else 1.0 end);
  end loop;

  v_runs := v_runs
    || jsonb_build_object(
         'member', v_elena,
         'session', (select id from public.workout_sessions
                     where plan_id = v_plan_elena_b and position = 1),
         'start', greatest(v_monday, current_date - 2) + time '09:30',
         'minutes', 60, 'fraction', 1.0)
    || jsonb_build_object(
         'member', v_elena,
         'session', (select id from public.workout_sessions
                     where plan_id = v_plan_elena_b and position = 2),
         'start', greatest(v_monday, current_date - 1) + time '09:30',
         'minutes', 58, 'fraction', 0.7);

  for v_w in 1 .. 3 loop
    v_runs := v_runs
      || jsonb_build_object(
           'member', v_lorenzo,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_lorenzo and position = 1),
           'start', (v_monday - v_w * 7 + 1) + time '19:00',
           'minutes', 55, 'fraction', 1.0)
      || jsonb_build_object(
           'member', v_lorenzo,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_lorenzo and position = 3),
           'start', (v_monday - v_w * 7 + 4) + time '19:00',
           'minutes', 60, 'fraction', 0.8);
  end loop;

  v_runs := v_runs || jsonb_build_object(
    'member', v_lorenzo,
    'session', (select id from public.workout_sessions
                where plan_id = v_plan_lorenzo and position = 1),
    'start', greatest(v_monday, current_date - 3) + time '19:00',
    'minutes', 55, 'fraction', 1.0);

  -- Alex trained hard, then stopped: his last run is three weeks old and his
  -- membership is suspended now, so section 8 writes the runs and no rewards at
  -- all. That asymmetry is patches/023 working, not a gap in the seed.
  for v_w in 3 .. 5 loop
    v_runs := v_runs
      || jsonb_build_object(
           'member', v_alex,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_alex and position = 1),
           'start', (v_monday - v_w * 7 + 1) + time '17:00',
           'minutes', 70, 'fraction', 1.0)
      || jsonb_build_object(
           'member', v_alex,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_alex and position = 2),
           'start', (v_monday - v_w * 7 + 3) + time '17:00',
           'minutes', 70, 'fraction', 1.0);
  end loop;

  -- Pierfelice barely started before the membership lapsed.
  v_runs := v_runs || jsonb_build_object(
    'member', v_pierfelice,
    'session', (select id from public.workout_sessions
                where plan_id = v_plan_pier and position = 1),
    'start', (v_monday - 33) + time '18:00',
    'minutes', 45, 'fraction', 0.6);

  for v_w in 1 .. 2 loop
    v_runs := v_runs
      || jsonb_build_object(
           'member', v_sofia,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_sofia and position = 1),
           'start', (v_monday - v_w * 7 + 1) + time '18:00',
           'minutes', 50, 'fraction', 1.0)
      || jsonb_build_object(
           'member', v_sofia,
           'session', (select id from public.workout_sessions
                       where plan_id = v_plan_sofia and position = 2),
           'start', (v_monday - v_w * 7 + 3) + time '18:00',
           'minutes', 50, 'fraction', 1.0);
  end loop;

  v_runs := v_runs || jsonb_build_object(
    'member', v_sofia,
    'session', (select id from public.workout_sessions
                where plan_id = v_plan_sofia and position = 1),
    'start', greatest(v_monday, current_date - 1) + time '18:00',
    'minutes', 50, 'fraction', 1.0);

  -- =========================================================================
  -- 8. Run that work list.
  --
  -- `pct`, `outcome` and the reward points are RECOMPUTED here with the same
  -- expressions as `close_workout_run_secure` (patches/023), never typed. The
  -- per-exercise LEAST() clamp is what stops an extra logged set from inflating
  -- the total past the prescription.
  -- =========================================================================
  for v_spec in select * from jsonb_array_elements(v_runs)
  loop
    v_run        := gen_random_uuid();
    v_session_id := (v_spec->>'session')::uuid;
    v_started    := (v_spec->>'start')::timestamptz;
    v_ended      := v_started + make_interval(mins => (v_spec->>'minutes')::int);
    v_rday       := (v_started at time zone 'Europe/Rome')::date;

    select coalesce(sum(item.target_sets), 0), session.name
    into v_target, v_name
    from public.workout_sessions session
    left join public.session_exercises item on item.session_id = session.id
    where session.id = v_session_id
    group by session.name;

    if coalesce(v_target, 0) = 0 then
      raise exception 'seed: session % has no prescribed exercises', v_session_id;
    end if;

    insert into public.workout_runs (id, session_id, member_id, started_at, note)
    values (v_run, v_session_id, (v_spec->>'member')::uuid, v_started,
            nullif(v_spec->>'note', ''));

    v_quota := floor(v_target * (v_spec->>'fraction')::numeric);

    for r in
      select id, position, target_sets, target_reps, target_weight
      from public.session_exercises
      where session_id = v_session_id
      order by position
    loop
      exit when v_quota <= 0;
      v_take := least(r.target_sets, v_quota);
      for v_i in 1 .. v_take loop
        insert into public.set_logs (
          id, run_id, session_exercise_id, member_id,
          set_number, reps, weight, performed_at
        ) values (
          gen_random_uuid(), v_run, r.id, (v_spec->>'member')::uuid,
          v_i,
          -- A real member does not hit the prescription exactly every time. The
          -- last set of an exercise drops a rep, which is what fatigue looks
          -- like in the log and stops the summary reading like a spec sheet.
          greatest(1, r.target_reps
                      - case when v_i = r.target_sets then 1 else 0 end),
          r.target_weight,
          v_started + make_interval(mins => (r.position - 1) * 9 + v_i * 2)
        );
      end loop;
      v_quota := v_quota - v_take;
    end loop;

    select coalesce(sum(least(coalesce(logged.amount, 0), item.target_sets)), 0)
    into v_done
    from public.session_exercises item
    left join (
      select session_exercise_id, count(*)::int as amount
      from public.set_logs where run_id = v_run
      group by session_exercise_id
    ) logged on logged.session_exercise_id = item.id
    where item.session_id = v_session_id;

    v_pct     := floor(100.0 * v_done / v_target);
    v_outcome := case when v_done >= v_target then 'completed'::public.run_outcome
                      else 'partial'::public.run_outcome end;
    v_points  := floor(30.0 * v_done / v_target);

    update public.workout_runs
    set ended_at = v_ended, outcome = v_outcome, pct = v_pct
    where id = v_run;

    -- No reward row while the membership is inactive (patches/023). The run
    -- still records its percentage -- the coach sees the work either way.
    if v_points > 0
       and public.has_active_subscription((v_spec->>'member')::uuid) then
      insert into public.rewards (
        member_id, run_id, workout_session_id, reward_day,
        code, title, points, earned_at
      ) values (
        (v_spec->>'member')::uuid, v_run, v_session_id, v_rday,
        'workout:' || v_run,
        case when v_outcome = 'completed' then 'Completed ' || v_name
             else v_name || ' - ' || v_pct || '%' end,
        v_points,
        -- The RPC leaves `earned_at` at its `now()` default, which is the
        -- moment the run closed. Stated explicitly here, or every seeded reward
        -- would carry the seed's clock and `groupByMonth` would render a single
        -- month.
        v_ended
      )
      on conflict (member_id, workout_session_id, reward_day)
        where workout_session_id is not null and reward_day is not null
        do nothing;
    end if;
  end loop;

  -- =========================================================================
  -- 9. The one open run in the database.
  --
  -- `workout_runs_one_open_per_member` is a partial unique index, so this is a
  -- per-member limit rather than a global one -- but giving it to Daniel alone
  -- keeps the mini-player demonstrable without leaving anyone else stuck unable
  -- to start a session.
  -- =========================================================================
  v_run := gen_random_uuid();
  v_session_id := (select id from public.workout_sessions
                   where plan_id = v_plan_daniel and position = 3);

  insert into public.workout_runs (id, session_id, member_id, started_at)
  values (v_run, v_session_id, v_daniel, now() - interval '25 minutes');

  -- First exercise done, the rest still to go: what a session looks like
  -- twenty-five minutes in.
  insert into public.set_logs (
    id, run_id, session_exercise_id, member_id,
    set_number, reps, weight, performed_at
  )
  select gen_random_uuid(), v_run, item.id, v_daniel, n,
         item.target_reps, item.target_weight,
         now() - interval '25 minutes' + make_interval(mins => n * 5)
  from public.session_exercises item
  cross join generate_series(1, 4) n
  where item.session_id = v_session_id and item.position = 1;

  -- =========================================================================
  -- 10. Nutrition plans.
  --
  -- One loop over a spec list, mirroring what `create_nutrition_plan_secure`
  -- (patches/022) refuses: a plan with no day type, a day type with no weekday,
  -- a day type with no meal.
  --
  -- Weekdays are 0 = Sunday .. 6 = Saturday, matching `Date#getDay()` so the
  -- client needs no translation. Within one plan they never overlap and they
  -- cover all seven days. The wizard enforces the no-overlap rule in the UI and
  -- nothing in the database does, so this file has to mean it -- and
  -- `verify.sql` checks it afterwards.
  -- =========================================================================
  for v_spec in select * from jsonb_array_elements($nut$[
    {"member": "daniel", "author": "marco", "created_days_before": 42,
     "name": "Lean Bulk", "kcal": 2600, "protein": 170, "carbs": 300, "fat": 75,
     "notes": "2.5L water/day. 1 tbsp olive oil per meal.",
     "days": [
      {"name": "Training Day", "position": 1, "weekdays": [1, 3, 5], "meals": [
        {"name": "Breakfast", "time": "07:30", "position": 1, "kcal": 520, "protein_g": 30, "carbs_g": 60, "fat_g": 15,
         "alternatives": "200g egg whites, 4 crispbreads, 15g walnuts",
         "items": [{"food": "Oats", "qty": "80 g"}, {"food": "Whey", "qty": "30 g"}, {"food": "Banana", "qty": "1"}]},
        {"name": "Lunch", "time": "13:00", "position": 2, "kcal": 820, "protein_g": 55, "carbs_g": 90, "fat_g": 20,
         "alternatives": "80g farro, 150g turkey breast",
         "items": [{"food": "Chicken breast", "qty": "200 g"}, {"food": "Rice", "qty": "120 g"}, {"food": "Olive oil", "qty": "10 g"}]},
        {"name": "Snack", "time": "17:00", "position": 3, "kcal": 380, "protein_g": 20, "carbs_g": 30, "fat_g": 15,
         "alternatives": "1 whole egg, 10g almonds",
         "items": [{"food": "Greek yogurt", "qty": "200 g"}, {"food": "Almonds", "qty": "25 g"}]},
        {"name": "Dinner", "time": "20:30", "position": 4, "kcal": 880, "protein_g": 50, "carbs_g": 70, "fat_g": 30,
         "alternatives": "250g sea bass, 60g wholegrain bread",
         "items": [{"food": "Salmon", "qty": "200 g"}, {"food": "Potatoes", "qty": "250 g"}, {"food": "Salad", "qty": "1 bowl"}]}
      ]},
      {"name": "Rest Day", "position": 2, "weekdays": [0, 2, 4, 6], "meals": [
        {"name": "Breakfast", "time": "07:30", "position": 1, "kcal": 480, "protein_g": 28, "carbs_g": 55, "fat_g": 12,
         "alternatives": "150g Greek yogurt, 30g oats",
         "items": [{"food": "Eggs", "qty": "3"}, {"food": "Wholegrain bread", "qty": "60 g"}]},
        {"name": "Lunch", "time": "13:00", "position": 2, "kcal": 780, "protein_g": 50, "carbs_g": 85, "fat_g": 18,
         "alternatives": "80g quinoa, 150g cod",
         "items": [{"food": "Turkey breast", "qty": "180 g"}, {"food": "Pasta", "qty": "100 g"}, {"food": "Mixed vegetables", "qty": "200 g"}]},
        {"name": "Dinner", "time": "20:30", "position": 3, "kcal": 720, "protein_g": 45, "carbs_g": 55, "fat_g": 25,
         "alternatives": "200g tofu, 200g sweet potato",
         "items": [{"food": "Beef", "qty": "180 g"}, {"food": "Rice", "qty": "100 g"}, {"food": "Broccoli", "qty": "200 g"}]}
      ]}
     ]},

    {"member": "sofia", "author": "giulia", "created_days_before": 14,
     "name": "Body Recomposition", "kcal": 1900, "protein": 140, "carbs": 180, "fat": 60,
     "notes": "Two litres of water a day. Weigh in Monday morning, before breakfast.",
     "days": [
      {"name": "Training Day", "position": 1, "weekdays": [1, 3, 5], "meals": [
        {"name": "Breakfast", "time": "07:00", "position": 1, "kcal": 420, "protein_g": 32, "carbs_g": 48, "fat_g": 9,
         "alternatives": "2 eggs, 50g wholegrain bread",
         "items": [{"food": "Greek yogurt", "qty": "200 g"}, {"food": "Oats", "qty": "50 g"}, {"food": "Blueberries", "qty": "100 g"}]},
        {"name": "Lunch", "time": "12:30", "position": 2, "kcal": 620, "protein_g": 45, "carbs_g": 65, "fat_g": 16,
         "alternatives": "150g cod, 70g couscous",
         "items": [{"food": "Chicken breast", "qty": "150 g"}, {"food": "Basmati rice", "qty": "80 g"}, {"food": "Courgette", "qty": "200 g"}]},
        {"name": "Post-workout", "time": "18:30", "position": 3, "kcal": 260, "protein_g": 28, "carbs_g": 32, "fat_g": 2,
         "alternatives": "300ml skimmed milk, 1 banana",
         "items": [{"food": "Whey", "qty": "30 g"}, {"food": "Rice cakes", "qty": "3"}]},
        {"name": "Dinner", "time": "20:30", "position": 4, "kcal": 600, "protein_g": 40, "carbs_g": 40, "fat_g": 28,
         "alternatives": "180g turkey, 200g pumpkin",
         "items": [{"food": "Salmon", "qty": "150 g"}, {"food": "Potatoes", "qty": "200 g"}, {"food": "Rocket", "qty": "1 bowl"}]}
      ]},
      {"name": "Rest Day", "position": 2, "weekdays": [2, 4], "meals": [
        {"name": "Breakfast", "time": "07:30", "position": 1, "kcal": 380, "protein_g": 30, "carbs_g": 38, "fat_g": 10,
         "alternatives": "200g cottage cheese, 1 pear",
         "items": [{"food": "Greek yogurt", "qty": "200 g"}, {"food": "Oats", "qty": "35 g"}]},
        {"name": "Lunch", "time": "12:30", "position": 2, "kcal": 560, "protein_g": 42, "carbs_g": 50, "fat_g": 18,
         "alternatives": "150g prawns, 60g farro",
         "items": [{"food": "Turkey breast", "qty": "150 g"}, {"food": "Wholegrain pasta", "qty": "70 g"}, {"food": "Spinach", "qty": "200 g"}]},
        {"name": "Dinner", "time": "20:00", "position": 3, "kcal": 540, "protein_g": 38, "carbs_g": 32, "fat_g": 26,
         "alternatives": "2 eggs, 150g chickpeas",
         "items": [{"food": "Cod", "qty": "180 g"}, {"food": "Sweet potato", "qty": "180 g"}, {"food": "Olive oil", "qty": "10 g"}]}
      ]},
      {"name": "Weekend", "position": 3, "weekdays": [0, 6], "meals": [
        {"name": "Brunch", "time": "10:30", "position": 1, "kcal": 650, "protein_g": 38, "carbs_g": 62, "fat_g": 24,
         "alternatives": "anything, within reason",
         "items": [{"food": "Eggs", "qty": "3"}, {"food": "Wholegrain bread", "qty": "80 g"}, {"food": "Avocado", "qty": "half"}]},
        {"name": "Dinner", "time": "20:30", "position": 2, "kcal": 700, "protein_g": 40, "carbs_g": 70, "fat_g": 25,
         "alternatives": "one meal out per weekend, no weighing",
         "items": [{"food": "Free choice", "qty": "1 plate"}]}
      ]}
     ]},

    {"member": "chiara", "author": "giulia", "created_days_before": 7,
     "name": "Maintenance", "kcal": 2100, "protein": 120, "carbs": 240, "fat": 70,
     "notes": "No weighing. Same day every day until it stops working.",
     "days": [
      {"name": "Every Day", "position": 1, "weekdays": [0, 1, 2, 3, 4, 5, 6], "meals": [
        {"name": "Breakfast", "time": "08:00", "position": 1, "kcal": 500, "protein_g": 25, "carbs_g": 65, "fat_g": 15,
         "items": [{"food": "Wholegrain bread", "qty": "80 g"}, {"food": "Jam", "qty": "20 g"}, {"food": "Milk", "qty": "250 ml"}]},
        {"name": "Lunch", "time": "13:00", "position": 2, "kcal": 750, "protein_g": 45, "carbs_g": 90, "fat_g": 22,
         "items": [{"food": "Pasta", "qty": "100 g"}, {"food": "Chicken breast", "qty": "150 g"}, {"food": "Salad", "qty": "1 bowl"}]},
        {"name": "Snack", "time": "17:00", "position": 3, "kcal": 250, "protein_g": 10, "carbs_g": 35, "fat_g": 8,
         "items": [{"food": "Fruit", "qty": "2 pieces"}, {"food": "Walnuts", "qty": "20 g"}]},
        {"name": "Dinner", "time": "20:00", "position": 4, "kcal": 600, "protein_g": 40, "carbs_g": 50, "fat_g": 25,
         "items": [{"food": "Fish", "qty": "180 g"}, {"food": "Potatoes", "qty": "200 g"}, {"food": "Vegetables", "qty": "200 g"}]}
      ]}
     ]}
  ]$nut$::jsonb)
  loop
    if coalesce(jsonb_array_length(v_spec->'days'), 0) = 0 then
      raise exception 'seed: nutrition plan "%" has no day type', v_spec->>'name';
    end if;

    v_plan_id := gen_random_uuid();
    v_started := (v_monday - (v_spec->>'created_days_before')::int) + time '11:00';

    insert into public.nutrition_plans (
      id, member_id, author_id, name, kcal_target, protein_g, carbs_g, fat_g,
      notes, created_at
    ) values (
      v_plan_id,
      (v_people->>(v_spec->>'member'))::uuid,
      (v_people->>(v_spec->>'author'))::uuid,
      v_spec->>'name', (v_spec->>'kcal')::int, (v_spec->>'protein')::int,
      (v_spec->>'carbs')::int, (v_spec->>'fat')::int,
      nullif(v_spec->>'notes', ''), v_started
    );

    for v_day in select * from jsonb_array_elements(v_spec->'days')
    loop
      if coalesce(jsonb_array_length(v_day->'weekdays'), 0) = 0 then
        raise exception 'seed: day type "%" claims no weekday', v_day->>'name';
      end if;
      if coalesce(jsonb_array_length(v_day->'meals'), 0) = 0 then
        raise exception 'seed: day type "%" has no meals', v_day->>'name';
      end if;

      v_day_id := gen_random_uuid();
      insert into public.nutrition_days (id, plan_id, name, position, weekdays)
      values (
        v_day_id, v_plan_id, v_day->>'name', (v_day->>'position')::int,
        array(select jsonb_array_elements_text(v_day->'weekdays'))::smallint[]
      );

      for v_meal in select * from jsonb_array_elements(v_day->'meals')
      loop
        insert into public.meals (
          id, day_id, name, time_of_day, position,
          kcal, protein_g, carbs_g, fat_g, alternatives, items
        ) values (
          gen_random_uuid(), v_day_id, v_meal->>'name', v_meal->>'time',
          (v_meal->>'position')::int,
          (v_meal->>'kcal')::int, (v_meal->>'protein_g')::int,
          (v_meal->>'carbs_g')::int, (v_meal->>'fat_g')::int,
          nullif(v_meal->>'alternatives', ''),
          coalesce(v_meal->'items', '[]'::jsonb)
        );
      end loop;
    end loop;
  end loop;

  -- =========================================================================
  -- 11. Appointments.
  --
  -- `pro_id` is always the member's assigned coach, which is what
  -- `create_appointment_secure` enforces. Offsets are relative to today so the
  -- agenda is never empty and the month calendar always has dots either side of
  -- it. A past slot is `done` or `cancelled`; nothing on a later day is.
  -- =========================================================================
  for r in
    select * from (values
      (v_daniel,     v_marco,  -14, time '10:00',  60, 'training',  'done'),
      (v_elena,      v_marco,  -10, time '09:00',  60, 'training',  'done'),
      (v_lorenzo,    v_marco,   -7, time '19:00',  60, 'training',  'cancelled'),
      (v_sofia,      v_giulia,  -7, time '18:00',  45, 'nutrition', 'done'),
      (v_daniel,     v_marco,   -5, time '10:00',  60, 'training',  'done'),
      (v_alex,       v_marco,   -3, time '17:00',  60, 'training',  'done'),
      (v_chiara,     v_giulia,  -3, time '11:00',  45, 'nutrition', 'done'),
      (v_daniel,     v_marco,    0, time '08:00',  60, 'training',  'done'),
      (v_lorenzo,    v_marco,    0, time '11:30',  30, 'protocol',  'confirmed'),
      (v_alex,       v_marco,    0, time '14:00',  30, 'nutrition', 'confirmed'),
      (v_pierfelice, v_marco,    0, time '15:00', 120, 'training',  'pending'),
      (v_sofia,      v_giulia,   0, time '16:00',  45, 'nutrition', 'confirmed'),
      (v_elena,      v_marco,    0, time '17:30',  30, 'protocol',  'pending'),
      (v_daniel,     v_marco,    2, time '14:00',  30, 'nutrition', 'confirmed'),
      (v_chiara,     v_giulia,   2, time '11:00',  45, 'nutrition', 'confirmed'),
      (v_elena,      v_marco,    3, time '09:00',  60, 'training',  'confirmed'),
      (v_lorenzo,    v_marco,    4, time '19:00',  60, 'training',  'confirmed'),
      (v_daniel,     v_marco,    5, time '10:00',  60, 'training',  'pending'),
      (v_sofia,      v_giulia,   7, time '18:00',  45, 'nutrition', 'pending'),
      (v_elena,      v_marco,    9, time '09:00',  60, 'training',  'pending'),
      (v_daniel,     v_marco,   12, time '10:00',  60, 'training',  'pending')
    ) as t(uid, coach, day_offset, starts, minutes, kind, status)
  loop
    insert into public.appointments (
      member_id, pro_id, kind, status, starts_at, ends_at
    ) values (
      r.uid, r.coach,
      r.kind::public.appointment_kind, r.status::public.appointment_status,
      (current_date + r.day_offset) + r.starts,
      (current_date + r.day_offset) + r.starts + make_interval(mins => r.minutes)
    );
  end loop;

  -- =========================================================================
  -- 12. Chat.
  --
  -- One thread per coaching pair. `messages_select` also requires that the
  -- member is assigned to that pro RIGHT NOW, so a thread left behind by an old
  -- assignment would render as an empty conversation rather than an error.
  --
  -- Anything older than six hours is read; anything newer is not. That is what
  -- puts a small, believable number on the unread badge instead of zero or
  -- thirty.
  -- =========================================================================
  for r in
    select * from (values
      (v_daniel,  v_marco,  true,   96, 'Welcome to Phase 2. Four sessions a week, same split, heavier.'),
      (v_daniel,  v_marco,  false,  94, 'Looks good. Is the Friday session still optional?'),
      (v_daniel,  v_marco,  true,   92, 'Not any more. Shoulders and core -- the one you keep skipping.'),
      (v_daniel,  v_marco,  false,  30, 'Squats felt heavy today, stopped after the leg press.'),
      (v_daniel,  v_marco,  true,   28, 'Fine. Drop to 70 kg next session and build back up.'),
      (v_daniel,  v_marco,  false,   3, 'Started back day, will send the numbers after.'),
      (v_daniel,  v_marco,  true,    2, 'Good. Watch the elbow position on the curls.'),
      (v_elena,   v_marco,  true,  120, 'Phase 2 is in. Same three days, a little more upper body volume.'),
      (v_elena,   v_marco,  false, 118, 'Thanks. The weight is finally moving.'),
      (v_elena,   v_marco,  false,   4, 'Can we move Thursday to the morning?'),
      (v_lorenzo, v_marco,  true,  200, 'Your membership runs out in under two weeks -- worth renewing before then.'),
      (v_lorenzo, v_marco,  false,   5, 'Will sort it this week.'),
      (v_sofia,   v_giulia, true,  100, 'Three day types: training, rest, weekend. The weekend one is deliberately looser.'),
      (v_sofia,   v_giulia, false,  98, 'Perfect. The rest day was the one I kept getting wrong.'),
      (v_sofia,   v_giulia, false,   1, 'Weighed in this morning, down another 400 g.'),
      (v_chiara,  v_giulia, true,   48, 'Maintenance plan is up. One day type, seven days, no thinking required.'),
      (v_chiara,  v_giulia, false,  46, 'That is exactly what I wanted.')
    ) as t(uid, coach, from_pro, hours_ago, body)
  loop
    select id into v_thread from public.threads
    where member_id = r.uid and pro_id = r.coach;
    if v_thread is null then
      insert into public.threads (member_id, pro_id)
      values (r.uid, r.coach) returning id into v_thread;
    end if;

    insert into public.messages (id, thread_id, sender_id, body, created_at, read_at)
    values (
      gen_random_uuid(), v_thread,
      case when r.from_pro then r.coach else r.uid end,
      r.body,
      now() - make_interval(hours => r.hours_ago),
      case when r.hours_ago > 6
           then now() - make_interval(hours => r.hours_ago) + interval '20 minutes'
           else null end
    );
  end loop;

  -- =========================================================================
  -- 13. Check-ins, as a work list and then one loop.
  --
  -- A member whose membership is not active gets neither a check-in nor its
  -- points: `redeem_checkin_token` turns their badge away at the door, so
  -- seeding one would depict a state the app cannot produce. That is why Alex
  -- and Pierfelice have none.
  --
  -- Several scans on one day are fine and realistic -- the real function records
  -- every scan and pays for only the first, which is what `unique (member_id,
  -- code)` on `checkin:<date>` enforces here too.
  -- =========================================================================
  for v_w in 1 .. 5 loop
    v_checkins := v_checkins
      || jsonb_build_object('member', v_daniel, 'pro', v_marco,
           'at', (v_monday - v_w * 7) + time '17:50')
      || jsonb_build_object('member', v_daniel, 'pro', v_marco,
           'at', (v_monday - v_w * 7 + 2) + time '18:20')
      || jsonb_build_object('member', v_daniel, 'pro', v_marco,
           'at', (v_monday - v_w * 7 + 4) + time '17:50');
  end loop;

  v_checkins := v_checkins
    || jsonb_build_object('member', v_daniel, 'pro', v_marco,
         'at', greatest(v_monday, current_date - 2) + time '07:50')
    || jsonb_build_object('member', v_daniel, 'pro', v_marco,
         'at', greatest(v_monday, current_date - 1) + time '12:20')
    || jsonb_build_object('member', v_daniel, 'pro', v_marco,
         'at', now() - interval '30 minutes');

  for v_w in 1 .. 4 loop
    v_checkins := v_checkins
      || jsonb_build_object('member', v_elena, 'pro', v_marco,
           'at', (v_monday - v_w * 7 + 1) + time '08:50')
      || jsonb_build_object('member', v_elena, 'pro', v_marco,
           'at', (v_monday - v_w * 7 + 3) + time '08:50');
  end loop;

  v_checkins := v_checkins
    || jsonb_build_object('member', v_elena, 'pro', v_marco,
         'at', greatest(v_monday, current_date - 1) + time '09:20');

  for v_w in 1 .. 2 loop
    v_checkins := v_checkins
      || jsonb_build_object('member', v_sofia, 'pro', v_giulia,
           'at', (v_monday - v_w * 7 + 1) + time '17:50')
      || jsonb_build_object('member', v_sofia, 'pro', v_giulia,
           'at', (v_monday - v_w * 7 + 3) + time '17:50');
  end loop;

  v_checkins := v_checkins
    || jsonb_build_object('member', v_lorenzo, 'pro', v_marco,
         'at', (v_monday - 6) + time '18:50')
    || jsonb_build_object('member', v_lorenzo, 'pro', v_marco,
         'at', (v_monday - 13) + time '18:50');

  for v_spec in select * from jsonb_array_elements(v_checkins)
  loop
    if public.has_active_subscription((v_spec->>'member')::uuid) then
      v_started := (v_spec->>'at')::timestamptz;
      v_rday    := (v_started at time zone 'Europe/Rome')::date;

      insert into public.checkins (member_id, scanned_by_id, created_at)
      values ((v_spec->>'member')::uuid, (v_spec->>'pro')::uuid, v_started);

      insert into public.rewards (
        member_id, reward_day, code, title, description, points, earned_at
      ) values (
        (v_spec->>'member')::uuid, v_rday, 'checkin:' || v_rday::text,
        'Gym check-in', 'Checked in at the gym', 10, v_started
      )
      -- Named constraint rather than the column form, exactly as patches/024
      -- explains: `unique (member_id, code)` already makes this one row per
      -- member per day, and `workout_session_id` stays null so it cannot
      -- collide with the partial index the workout rewards use.
      on conflict on constraint rewards_member_id_code_key do nothing;
    end if;
  end loop;

  -- =========================================================================
  -- 14. Body metrics.
  --
  -- ponytail: no screen reads these today -- only `save_body_metric_secure`
  -- survives from that feature. A handful of rows cost nothing, keep the table
  -- from being empty in the schema chapter, and are the trend the progress
  -- screen will want if it is ever wired back up.
  -- =========================================================================
  insert into public.body_metrics (
    member_id, recorded_by_id, measured_on, weight_kg, note
  )
  select v_elena, v_marco, current_date - (w * 7), 78.5 + (w * 0.5),
         case when w = 0
              then 'Diet adherence 90%. Energy good through the day, a little hungry around 10 PM.'
              else null end
  from generate_series(0, 4) w
  on conflict (member_id, measured_on) do nothing;

  insert into public.body_metrics (
    member_id, recorded_by_id, measured_on, weight_kg, note
  )
  select v_sofia, v_giulia, current_date - (w * 7), 61.2 + (w * 0.4), null
  from generate_series(0, 2) w
  on conflict (member_id, measured_on) do nothing;

  -- =========================================================================
  -- 15. Notifications.
  --
  -- Not inserted by hand. Every row in `notifications` was produced by the
  -- triggers from `patches/020` firing on the messages, appointments and plans
  -- above -- which is both the honest way to populate the table and a live
  -- proof that those triggers work.
  --
  -- Two adjustments, because a trigger stamps `created_at` with the transaction
  -- clock and every row would otherwise share one instant:
  --
  --   * spread them backwards at three-hour intervals, so the list reads as a
  --     history rather than a burst. ponytail: the ordering is by id, which is
  --     arbitrary -- there is no key linking a notification back to the row that
  --     caused it, so a faithful reconstruction is not available at any price
  --     worth paying here.
  --   * mark everything older than nine hours read, which leaves the three most
  --     recent per user unread and the bell showing a believable badge.
  -- =========================================================================
  with ordered as (
    select id,
           row_number() over (partition by user_id order by id) as rn,
           count(*)     over (partition by user_id)             as total
    from public.notifications
  )
  update public.notifications n
  -- Cast: row_number() and count(*) are bigint, and make_interval's parameters
  -- are int -- an uncast bigint fails to resolve the function at all.
  set created_at = now() - make_interval(hours => ((ordered.total - ordered.rn) * 3)::int)
  from ordered
  where ordered.id = n.id;

  update public.notifications
  set read_at = created_at + interval '20 minutes'
  where created_at < now() - interval '9 hours';

  -- =========================================================================
  -- 16. Put the push configuration back.
  -- =========================================================================
  update public.app_config
  set key = replace(key, 'parked:', '')
  where key like 'parked:%';

  raise notice 'Seed complete. Week anchored on %.', v_monday;
end
$seed$;

-- What landed. Not a verification -- run `verify.sql` for that.
select 'profiles'          as table_name, count(*) from public.profiles
union all select 'workout_plans',     count(*) from public.workout_plans
union all select 'workout_sessions',  count(*) from public.workout_sessions
union all select 'session_exercises', count(*) from public.session_exercises
union all select 'workout_runs',      count(*) from public.workout_runs
union all select 'set_logs',          count(*) from public.set_logs
union all select 'rewards',           count(*) from public.rewards
union all select 'nutrition_plans',   count(*) from public.nutrition_plans
union all select 'nutrition_days',    count(*) from public.nutrition_days
union all select 'meals',             count(*) from public.meals
union all select 'appointments',      count(*) from public.appointments
union all select 'availability',      count(*) from public.availability
union all select 'threads',           count(*) from public.threads
union all select 'messages',          count(*) from public.messages
union all select 'checkins',          count(*) from public.checkins
union all select 'body_metrics',      count(*) from public.body_metrics
union all select 'notifications',     count(*) from public.notifications
order by table_name;
