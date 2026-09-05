-- PARTLY SUPERSEDED by supabase/seed.sql. DO NOT RUN after seed.sql.
--
-- Kept because it is part of the applied history of the live database, and
-- because the FIRST half of this file -- the four `auth.users` rows for clients
-- who never sign in -- is the technique `seed.sql` still uses. It is reproduced
-- there, on the `@trainhub.com` domain and with a fifth client.
--
-- The SECOND half is not merely redundant, it is wrong by today's rules: the
-- three `workout_sessions` it writes per client carry NO `session_exercises`,
-- which `_insert_session_bundle` (patches/015) rejects with 22023 and which
-- makes every run on those sessions score 0% and pay nothing. That defect is
-- the reason `seed.sql` was rewritten.
--
-- Its PASS/FAIL block at the bottom expects five clients and seven appointments
-- today, which described the database in Phase 3 and does not now. Use
-- `verify.sql`.
--
-- ---------------------------------------------------------------------------

-- Four extra demo clients for Coach Andrea, named after the people the
-- wireframes draw (pt/04 and pt/05).
--
-- They exist so the roster, the agenda and the calendar are not a list of one.
-- They never sign in: no `auth.identities` row is created, so there is no
-- credential to log in with, and the empty `encrypted_password` matches nothing
-- bcrypt can produce.
--
-- Idempotent: every insert is guarded, so a second run changes nothing.
--
-- If inserting into `auth.users` is ever rejected by a future Supabase release,
-- create the four accounts by hand in Authentication -> Users with "Auto Confirm
-- User" ticked, using the same four addresses, then run this file again: the
-- second half looks the users up by email and works either way.

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
  ('elena@trainhub.dev',      'Elena Mingotti'),
  ('lorenzo@trainhub.dev',    'Lorenzo Mamone'),
  ('alex@trainhub.dev',       'Alex Giustacchini'),
  ('pierfelice@trainhub.dev', 'Pierfelice Rocco')
) as t(email, full_name)
-- `auth.users` unique-indexes email only partially (`where is_sso_user = false`),
-- so `on conflict (email)` would not match it.  Guard explicitly instead.
where not exists (select 1 from auth.users u where u.email = t.email);

do $$
declare
  v_pro_id  uuid;
  v_id      uuid;
  v_plan_id uuid;
  r         record;
begin
  select id into v_pro_id from auth.users where email = 'andrea@trainhub.dev';
  if v_pro_id is null then
    raise exception 'Run seed.sql first: Coach Andrea does not exist';
  end if;

  for r in
    select * from (values
      -- email, goal, level, subscription_status, months of subscription left
      ('elena@trainhub.dev',      'Weight Loss',  'Intermediate', 'active',    6),
      ('lorenzo@trainhub.dev',    'Hypertrophy',  'Beginner',     'active',    1),
      ('alex@trainhub.dev',       'Strength',     'Advanced',     'suspended', 3),
      ('pierfelice@trainhub.dev', 'Conditioning', 'Beginner',     'expired',   0)
    ) as t(email, goal, level, sub_status, months)
  loop
    select id into v_id from auth.users where email = r.email;
    continue when v_id is null;

    -- `on_auth_user_created` already made the profile row; this fills in the
    -- parts only the seed knows.  Upsert rather than update, so the file also
    -- works when the accounts were created by hand before the trigger existed.
    insert into profiles (id, role, full_name, assigned_pro_id,
                          subscription_status, subscription_until)
    values (
      v_id, 'member',
      (select raw_user_meta_data->>'full_name' from auth.users where id = v_id),
      v_pro_id,
      r.sub_status::subscription_status,
      case when r.months = 0
           then current_date - interval '2 weeks'
           else current_date + (r.months || ' months')::interval
      end
    )
    on conflict (id) do update set
      role = excluded.role,
      full_name = excluded.full_name,
      assigned_pro_id = excluded.assigned_pro_id,
      subscription_status = excluded.subscription_status,
      subscription_until = excluded.subscription_until;

    -- One plan each, so the roster can print a goal and the client dossier is
    -- not empty.  Guarded by name: a second run finds it and skips.
    select id into v_plan_id from workout_plans
    where member_id = v_id and name = r.goal || ' - Phase 1';

    if v_plan_id is null then
      insert into workout_plans (member_id, author_id, name, goal, level, weeks, expires_on)
      values (v_id, v_pro_id, r.goal || ' - Phase 1', r.goal, r.level, 6,
              current_date + interval '6 weeks')
      returning id into v_plan_id;

      insert into workout_sessions (plan_id, name, position, status) values
        (v_plan_id, 'Upper Body',  1, 'completed'),
        (v_plan_id, 'Lower Body',  2, 'todo'),
        (v_plan_id, 'Full Body',   3, 'todo');
    end if;
  end loop;

  -- Today's agenda, mirroring pt/04 - Home Page.  Guarded on the exact slot so
  -- a re-run does not stack duplicates.
  for r in
    select * from (values
      ('elena@trainhub.dev',      'training',  'done',      time '10:00', time '11:00'),
      ('lorenzo@trainhub.dev',    'protocol',  'confirmed', time '11:30', time '12:00'),
      ('alex@trainhub.dev',       'nutrition', 'confirmed', time '14:00', time '14:30'),
      ('pierfelice@trainhub.dev', 'training',  'pending',   time '15:00', time '17:00'),
      ('elena@trainhub.dev',      'protocol',  'pending',   time '17:30', time '18:00')
    ) as t(email, kind, status, starts, ends)
  loop
    select id into v_id from auth.users where email = r.email;
    continue when v_id is null;

    insert into appointments (member_id, pro_id, kind, status, starts_at, ends_at)
    select v_id, v_pro_id, r.kind::appointment_kind, r.status::appointment_status,
           current_date + r.starts, current_date + r.ends
    where not exists (
      select 1 from appointments a
      where a.pro_id = v_pro_id
        and a.member_id = v_id
        and a.starts_at = current_date + r.starts
    );
  end loop;

  -- Five weekly measurements for Elena, so the progress screen has a trend to
  -- draw rather than a single point.
  select id into v_id from auth.users where email = 'elena@trainhub.dev';
  if v_id is not null then
    insert into body_metrics (member_id, recorded_by_id, measured_on, weight_kg, note)
    select v_id, v_pro_id, current_date - (w * 7),
           78.5 + (w * 0.5),
           case when w = 0
                then 'Diet adherence 90%. Energy good through the day, a little hungry around 10 PM.'
                else null
           end
    from generate_series(0, 4) w
    on conflict (member_id, measured_on) do nothing;
  end if;

  raise notice 'Demo clients ready for pro %', v_pro_id;
end $$;

-- Every row must read PASS.
select
  check_name,
  actual,
  expected,
  case when actual = expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('clients assigned to Coach Andrea',
     (select count(*)::text from profiles
      where assigned_pro_id = (select id from auth.users where email = 'andrea@trainhub.dev')),
     '5'),
    ('appointments today',
     (select count(*)::text from appointments
      where starts_at >= current_date and starts_at < current_date + 1),
     '7'),
    ('body metrics for Elena',
     (select count(*)::text from body_metrics
      where member_id = (select id from auth.users where email = 'elena@trainhub.dev')),
     '5')
) as t(check_name, actual, expected);
