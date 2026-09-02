-- TrainHub demo data.  Run after the two auth users exist.
--
-- NOT idempotent.  Profiles, exercises and rewards are guarded, but the plan,
-- sessions, meals, appointments and check-ins would be duplicated by a second
-- run.  To re-seed, wipe the demo content first (this leaves the auth users
-- and their profiles alone -- the foreign keys cascade the rest):
--
--   truncate workout_plans, nutrition_plans, appointments, availability,
--            threads, checkins, rewards restart identity cascade;
--
-- Every local is `v_`-prefixed on purpose.  PL/pgSQL defaults
-- `plpgsql.variable_conflict` to `error`, so a variable sharing a name with a
-- column in scope -- `plan_id`, `member_id`, `pro_id` all exist as columns
-- here -- aborts the block with "column reference is ambiguous".

do $$
declare
  v_member_id uuid;
  v_pro_id    uuid;
  v_plan_id   uuid;
  v_nut_id    uuid;
  v_thread_id uuid;
  v_chest_id  uuid;
  v_leg_id    uuid;
begin
  select id into v_member_id from auth.users where email = 'daniel@trainhub.dev';
  select id into v_pro_id    from auth.users where email = 'andrea@trainhub.dev';

  if v_member_id is null or v_pro_id is null then
    raise exception 'Create both demo auth users before running seed.sql';
  end if;

  -- Profiles --------------------------------------------------------------
  -- Upsert rather than update.  The `on_auth_user_created` trigger normally
  -- creates these rows, but it only fires for users inserted AFTER schema.sql
  -- ran -- and a plain UPDATE against a missing row succeeds silently at zero
  -- rows, so the failure would surface much later as a foreign key violation.
  -- The professional goes first: the member references it via assigned_pro_id.
  insert into profiles (id, role, specialty, full_name, bio)
  values (v_pro_id, 'professional', 'both', 'Coach Andrea',
          'Strength coach and nutritionist. 12 years on the gym floor.')
  on conflict (id) do update set
    role = excluded.role, specialty = excluded.specialty,
    full_name = excluded.full_name, bio = excluded.bio;

  insert into profiles (id, role, specialty, full_name, assigned_pro_id,
                        subscription_status, subscription_until)
  values (v_member_id, 'member', null, 'Daniel Aresta', v_pro_id, 'active',
          current_date + interval '8 months')
  on conflict (id) do update set
    role = excluded.role, specialty = excluded.specialty,
    full_name = excluded.full_name, assigned_pro_id = excluded.assigned_pro_id,
    subscription_status = excluded.subscription_status,
    subscription_until = excluded.subscription_until;

  -- Exercise catalogue ----------------------------------------------------
  insert into exercises (name, muscle_group, equipment, instructions) values
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

  -- Workout plan, mirroring gym_member/02 - Workout.png --------------------
  insert into workout_plans (member_id, author_id, name, goal, level, weeks, expires_on)
  values (v_member_id, v_pro_id, 'Hypertrophy - Phase 1', 'Strength', 'Beginner', 6,
          current_date + interval '6 weeks')
  returning id into v_plan_id;

  insert into workout_sessions (plan_id, name, position, status) values
    (v_plan_id, 'Chest Day',    1, 'completed'),
    (v_plan_id, 'Leg Day',      2, 'in_progress'),
    (v_plan_id, 'Back Day',     3, 'todo'),
    (v_plan_id, 'Shoulder Day', 4, 'todo');

  select id into v_chest_id from workout_sessions
  where plan_id = v_plan_id and position = 1;
  select id into v_leg_id from workout_sessions
  where plan_id = v_plan_id and position = 2;

  insert into session_exercises (session_id, exercise_id, position, target_sets, target_reps, target_weight)
  select v_chest_id, id, row_number() over (order by name), 4, 10, 60
  from exercises where muscle_group = 'Chest';

  insert into session_exercises (session_id, exercise_id, position, target_sets, target_reps, target_weight)
  select v_leg_id, id, row_number() over (order by name), 4, 8, 80
  from exercises where muscle_group = 'Legs';

  -- Nutrition plan --------------------------------------------------------
  insert into nutrition_plans (member_id, author_id, name, kcal_target, protein_g, carbs_g, fat_g)
  values (v_member_id, v_pro_id, 'Lean Bulk', 2600, 170, 300, 75)
  returning id into v_nut_id;

  insert into meals (plan_id, name, time_of_day, position, kcal, items) values
    (v_nut_id, 'Breakfast', '07:30', 1, 520,
     '[{"food":"Oats","qty":"80 g"},{"food":"Whey","qty":"30 g"},{"food":"Banana","qty":"1"}]'),
    (v_nut_id, 'Lunch',     '13:00', 2, 820,
     '[{"food":"Chicken breast","qty":"200 g"},{"food":"Rice","qty":"120 g"},{"food":"Olive oil","qty":"10 g"}]'),
    (v_nut_id, 'Snack',     '17:00', 3, 380,
     '[{"food":"Greek yogurt","qty":"200 g"},{"food":"Almonds","qty":"25 g"}]'),
    (v_nut_id, 'Dinner',    '20:30', 4, 880,
     '[{"food":"Salmon","qty":"200 g"},{"food":"Potatoes","qty":"250 g"},{"food":"Salad","qty":"1 bowl"}]');

  -- Availability: weekday mornings and afternoons --------------------------
  insert into availability (pro_id, weekday, starts_at, ends_at)
  select v_pro_id, d, '09:00', '13:00' from generate_series(1, 5) d;
  insert into availability (pro_id, weekday, starts_at, ends_at)
  select v_pro_id, d, '14:00', '19:00' from generate_series(1, 5) d;

  -- Today's agenda, mirroring both Home Page wireframes --------------------
  insert into appointments (member_id, pro_id, kind, status, starts_at, ends_at) values
    (v_member_id, v_pro_id, 'training', 'done',
     current_date + time '10:00', current_date + time '11:00'),
    (v_member_id, v_pro_id, 'protocol', 'confirmed',
     current_date + time '11:30', current_date + time '12:00'),
    (v_member_id, v_pro_id, 'nutrition', 'confirmed',
     current_date + interval '2 days' + time '14:00',
     current_date + interval '2 days' + time '14:30');

  -- Chat ------------------------------------------------------------------
  -- RETURNING yields no row when ON CONFLICT DO NOTHING fires, so a re-run
  -- has to fall back to looking the thread up.
  insert into threads (member_id, pro_id) values (v_member_id, v_pro_id)
  on conflict (member_id, pro_id) do nothing
  returning id into v_thread_id;

  if v_thread_id is null then
    select id into v_thread_id from threads
    where member_id = v_member_id and pro_id = v_pro_id;
  end if;

  insert into messages (id, thread_id, sender_id, body, created_at) values
    (gen_random_uuid(), v_thread_id, v_pro_id,
     'Leg day is loaded for this week. Keep the squat at 80 kg.', now() - interval '3 hours'),
    (gen_random_uuid(), v_thread_id, v_member_id,
     'Got it. Lower back felt tight last time, is that normal?', now() - interval '2 hours'),
    (gen_random_uuid(), v_thread_id, v_pro_id,
     'Common at this stage. Add the hip mobility drill before you start.', now() - interval '1 hour');

  -- Rewards ---------------------------------------------------------------
  insert into rewards (member_id, code, title, description, points) values
    (v_member_id, 'first_session', 'First Session', 'Completed your first workout.', 50),
    (v_member_id, 'week_streak',   'Week Streak',   'Trained every scheduled day this week.', 120),
    (v_member_id, 'early_bird',    'Early Bird',    'Checked in before 8 AM five times.', 80)
  on conflict (member_id, code) do nothing;

  -- Check-in history --------------------------------------------------------
  insert into checkins (member_id, scanned_by_id, created_at)
  select v_member_id, v_pro_id, now() - (d || ' days')::interval
  from generate_series(1, 6) d;

  raise notice 'Seed complete for % and %', v_member_id, v_pro_id;
end $$;
