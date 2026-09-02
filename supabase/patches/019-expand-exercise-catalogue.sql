-- Patch 019 -- expand the exercise catalogue to Biceps, Triceps and Core.
--
-- The seeded catalogue only ever covered Chest, Legs, Back and Shoulders.
-- `muscle_group` is free text -- `SessionForm.jsx`'s Autocomplete groups by
-- whatever is present, no schema constraint -- so this is content, not a
-- schema change: same `on conflict (name) do nothing` pattern `seed.sql`
-- already uses.
--
-- Idempotent: safe to replay.

begin;

insert into public.exercises (name, muscle_group, equipment, instructions) values
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

drop table if exists pg_temp.patch_019_checks;
create temporary table patch_019_checks (
  check_name text not null, actual text, expected text not null
) on commit preserve rows;

insert into patch_019_checks (check_name, actual, expected) values
  ('seven muscle groups are represented',
   (select count(distinct muscle_group)::text from public.exercises), '7'),
  ('at least three exercises per each new muscle group',
   (select (min(cnt) >= 3)::text from (
     select count(*) cnt from public.exercises
     where muscle_group in ('Biceps', 'Triceps', 'Core')
     group by muscle_group
   ) counts),
   'true');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_019_checks
order by check_name;
