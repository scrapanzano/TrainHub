-- TrainHub database checks, after patches 001-026 and seed.sql.
--
-- One query on purpose: the Supabase SQL editor only renders the result of the
-- LAST statement in a script, so a file of separate SELECTs silently shows you
-- just the final one.
--
-- EVERY ROW MUST READ PASS ON A FRESHLY SEEDED DATABASE. Run `seed.sql`, then
-- this. If a row fails, the database does not hold what the application would
-- have put there -- fix the data, not the expectation.
--
-- Four kinds of check, in this order:
--
--   1. SCHEMA AND SECURITY -- the structure and the grants.
--   2. INTEGRITY -- every one of these counts VIOLATIONS and expects zero, and
--      every one is TRUE AT ALL TIMES. They re-derive, independently of
--      `seed.sql`, the rules the secure RPCs enforce at write time: a session
--      always has exercises, a run's percentage matches the sets actually
--      logged, a reward is worth what `close_workout_run_secure` would have
--      paid, a thread's member is still assigned to its professional.
--   3. SEED STATE -- true of the database as `seed.sql` leaves it, and NOT
--      invariant afterwards. Ordinary use can legitimately break these: a
--      membership lapsing, or a professional pressing Suspend or Reactivate,
--      changes who counts as active without touching the reward rows already
--      earned -- which is deliberate, because points earned while active are
--      kept. A failure here means "re-run the seed", not "the data is corrupt".
--      Kept separate from INTEGRITY for exactly that reason.
--   4. DEMO READINESS -- the states a demo needs to be able to show at all.
--
-- Caveat, unchanged: this runs as the dashboard's privileged role, which
-- bypasses RLS. It proves the rows and policies EXIST; it does not prove the
-- policies are correct from the app's point of view. That is what
-- `probe-rls.mjs` and `probe-security.mjs` are for -- they sign in through the
-- same public API as the browser.

select
  section,
  check_name,
  coalesce(actual, '(null)') as actual,
  expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end as status
from (
  values
    -- =======================================================================
    -- 1. SCHEMA AND SECURITY
    -- =======================================================================
    -- `schema.sql` declares 20 tables; `patches/020`'s `notifications` makes
    -- 21. The historical create-if-missing patches remain safe to replay in
    -- order.
    ('schema', 'public tables',
     (select count(*)::text from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'), '21'),

    ('schema', 'tables with RLS enabled',
     (select count(*)::text from pg_tables
      where schemaname = 'public' and rowsecurity), '21'),

    -- RLS switched on with zero policies denies everything: it passes the
    -- check above while silently breaking every read the app makes.
    --
    -- 20, one short of the table count, and that gap is the assertion rather
    -- than a gap in coverage: `app_config` holds the secret that authenticates
    -- the database to the notify Edge Function and is deliberately policy-less
    -- AND grant-less, so RLS-on-with-no-policy denies every PostgREST caller
    -- and the missing grant denies them one gate earlier. Only `notify_user()`,
    -- which is `security definer`, reads it. If either of the two read rows
    -- below ever reads 21, that table became reachable from the browser.
    ('schema', 'tables with at least one policy',
     (select count(distinct tablename)::text from pg_policies
      where schemaname = 'public'), '20'),

    -- RLS is the second gate, not the first. PostgREST connects as `anon` and
    -- switches to `authenticated`, and Postgres checks the table GRANT before
    -- it ever evaluates a policy -- so a table with perfect RLS and no grant
    -- fails with `42501 permission denied`, which the two checks above cannot
    -- see. Not hypothetical: `drop schema public cascade` takes the grants with
    -- it, and `grant on all tables` only touches tables that already exist, so
    -- every table created afterwards is born unreachable.
    ('schema', 'tables the app role can read',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'select')),
     '20'),

    ('schema', 'tables the app role can write',
     (select count(*)::text from pg_tables
      where schemaname = 'public'
        and has_table_privilege('authenticated', format('%I.%I', schemaname, tablename), 'insert')),
     -- `patches/015` removed direct INSERT from ten protected tables;
     -- `patches/022` removes it from nutrition_plans and meals too
     -- (nutrition_days never had it). The remaining six use ordinary RLS
     -- writes.
     '6'),

    ('schema', 'protected tables reject direct insert privileges',
     (select count(*)::text from (values
       ('workout_plans'), ('workout_sessions'), ('session_exercises'),
       ('workout_runs'), ('set_logs'), ('rewards'), ('appointments'),
       ('threads'), ('checkins'), ('body_metrics'), ('nutrition_plans'),
       ('nutrition_days'), ('meals')
     ) as protected(tablename)
     where not has_table_privilege(
       'authenticated', format('public.%I', protected.tablename), 'insert')),
     '13'),

    ('schema', 'patch 015 secure operations',
     (select count(*)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'create_appointment_secure', 'set_appointment_status_secure',
          'ensure_assigned_thread', 'save_body_metric_secure',
          'create_workout_plan_secure', 'create_workout_session_secure',
          'add_session_exercise_secure', 'start_workout_run_secure',
          'pause_workout_run_secure', 'resume_workout_run_secure',
          'log_workout_set_secure', 'close_workout_run_secure',
          'save_workout_run_note_secure'
        )
        and p.prosecdef
        and coalesce(
          p.proconfig && array['search_path=', 'search_path=""'], false)),
     '13'),

    -- `patches/022` and `patches/023` add three more, and each must be as
    -- hardened as the thirteen above.
    ('schema', 'patch 022/023 secure operations',
     (select count(*)::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'create_nutrition_plan_secure', 'set_subscription_status_secure',
          'has_active_subscription')
        and p.prosecdef
        and coalesce(
          p.proconfig && array['search_path=', 'search_path=""'], false)),
     '3'),

    ('schema', 'workout completion counts only logged sets',
     (select coalesce(
        regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
          like '%least(coalesce(logged.amount,0),item.target_sets)%',
        false)::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'close_workout_run_secure'),
     'true'),

    -- `patches/023`: an inactive membership earns no reward row.
    ('schema', 'closing a run checks the membership before paying',
     (select coalesce(
        regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
          like '%public.has_active_subscription(v_row.member_id)%',
        false)::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'close_workout_run_secure'),
     'true'),

    -- `patches/025`: the avatar bucket and its four policies.
    ('schema', 'avatar bucket is public',
     (select (count(*) = 1)::text from storage.buckets
      where id = 'avatars' and public), 'true'),

    ('schema', 'avatar write policies all name the caller',
     (select count(*)::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('avatars_insert_own', 'avatars_update_own',
                           'avatars_delete_own')
        and coalesce(qual, '') || coalesce(with_check, '') like '%uid()%'),
     '3'),

    -- =======================================================================
    -- 2. INTEGRITY -- every row counts violations and expects '0'
    -- =======================================================================

    -- The defect this whole rewrite exists to stop. `_insert_session_bundle`
    -- (patches/015) raises 22023 on a session with no exercises; a seeded one
    -- makes every run on it score 0% and pay nothing, forever.
    ('integrity', 'sessions with no prescribed exercise',
     (select count(*)::text from public.workout_sessions s
      where not exists (select 1 from public.session_exercises e
                        where e.session_id = s.id)), '0'),

    ('integrity', 'plans with no session',
     (select count(*)::text from public.workout_plans p
      where not exists (select 1 from public.workout_sessions s
                        where s.plan_id = p.id)), '0'),

    -- `position` is `max(position) + 1`, never `count + 1`, so the app's own
    -- positions stay contiguous from 1. With `unique (plan_id, position)` in
    -- place, min = 1 and max = the row count is exactly contiguity.
    ('integrity', 'session positions not contiguous from 1',
     (select count(*)::text from (
        select plan_id from public.workout_sessions
        group by plan_id
        having min(position) <> 1 or max(position) <> count(*)) bad), '0'),

    ('integrity', 'exercise positions not contiguous from 1',
     (select count(*)::text from (
        select session_id from public.session_exercises
        group by session_id
        having min(position) <> 1 or max(position) <> count(*)) bad), '0'),

    ('integrity', 'day type positions not contiguous from 1',
     (select count(*)::text from (
        select plan_id from public.nutrition_days
        group by plan_id
        having min(position) <> 1 or max(position) <> count(*)) bad), '0'),

    ('integrity', 'meal positions not contiguous from 1',
     (select count(*)::text from (
        select day_id from public.meals
        group by day_id
        having min(position) <> 1 or max(position) <> count(*)) bad), '0'),

    -- What `validate_workout_run_chain` (patches/015) enforces at write time.
    ('integrity', 'runs whose member does not own the session plan',
     (select count(*)::text
      from public.workout_runs r
      join public.workout_sessions s on s.id = r.session_id
      join public.workout_plans p on p.id = s.plan_id
      where p.member_id <> r.member_id), '0'),

    -- What `validate_set_log_chain` enforces: a set belongs to a run, that run
    -- belongs to the same member, and the exercise belongs to the run's
    -- session.
    ('integrity', 'set logs not tied to their run, member and session',
     (select count(*)::text
      from public.set_logs l
      left join public.workout_runs r on r.id = l.run_id
      left join public.session_exercises e on e.id = l.session_exercise_id
      where l.run_id is null
         or r.id is null
         or r.member_id <> l.member_id
         or r.session_id <> e.session_id), '0'),

    ('integrity', 'members with more than one open run',
     (select count(*)::text from (
        select member_id from public.workout_runs where ended_at is null
        group by member_id having count(*) > 1) bad), '0'),

    ('integrity', 'runs that started before their plan existed',
     (select count(*)::text
      from public.workout_runs r
      join public.workout_sessions s on s.id = r.session_id
      join public.workout_plans p on p.id = s.plan_id
      where r.started_at < p.created_at), '0'),

    -- The recomputation. `pct` is not a number anyone may type: it is
    -- `floor(100 * done / target)` where `done` clamps each exercise's logged
    -- sets to its prescription. If this row fails, a summary screen is showing
    -- a percentage its own set logs do not support.
    ('integrity', 'closed runs whose pct disagrees with their set logs',
     (select count(*)::text
      from public.workout_runs r
      join lateral (
        select coalesce(sum(item.target_sets), 0) as target,
               coalesce(sum(least(coalesce(l.amount, 0), item.target_sets)), 0) as done
        from public.session_exercises item
        left join (select session_exercise_id, count(*)::int as amount
                   from public.set_logs where run_id = r.id
                   group by session_exercise_id) l
          on l.session_exercise_id = item.id
        where item.session_id = r.session_id
      ) calc on true
      where r.ended_at is not null
        and r.pct is distinct from
            (case when calc.target = 0 then 0
                  else floor(100.0 * calc.done / calc.target)::int end)), '0'),

    ('integrity', 'closed runs whose outcome disagrees with their set logs',
     (select count(*)::text
      from public.workout_runs r
      join lateral (
        select coalesce(sum(item.target_sets), 0) as target,
               coalesce(sum(least(coalesce(l.amount, 0), item.target_sets)), 0) as done
        from public.session_exercises item
        left join (select session_exercise_id, count(*)::int as amount
                   from public.set_logs where run_id = r.id
                   group by session_exercise_id) l
          on l.session_exercise_id = item.id
        where item.session_id = r.session_id
      ) calc on true
      where r.ended_at is not null
        and r.outcome <> 'abandoned'
        and r.outcome is distinct from
            (case when calc.target > 0 and calc.done >= calc.target
                  then 'completed' else 'partial' end)::public.run_outcome), '0'),

    ('integrity', 'workout rewards worth the wrong number of points',
     (select count(*)::text
      from public.rewards w
      join public.workout_runs r on r.id = w.run_id
      join lateral (
        select coalesce(sum(item.target_sets), 0) as target,
               coalesce(sum(least(coalesce(l.amount, 0), item.target_sets)), 0) as done
        from public.session_exercises item
        left join (select session_exercise_id, count(*)::int as amount
                   from public.set_logs where run_id = r.id
                   group by session_exercise_id) l
          on l.session_exercise_id = item.id
        where item.session_id = r.session_id
      ) calc on true
      where calc.target > 0
        and w.points is distinct from floor(30.0 * calc.done / calc.target)::int),
     '0'),

    -- =======================================================================
    -- 3. SEED STATE -- true after `seed.sql`, not invariant afterwards
    -- =======================================================================

    -- Work that earned points and was never paid. The second NOT EXISTS is the
    -- daily cap -- one award per session per day, so a second run of the same
    -- session that day legitimately pays nothing.
    --
    -- NOT an invariant: the membership filter reads the member's status NOW,
    -- while the reward was written when the run closed. Reactivating a
    -- suspended member turns every reward-less run they already have into a
    -- reported violation, and that is the app working, not failing. Alex is
    -- seeded suspended precisely so his runs carry no points.
    ('seed', 'earned runs with no reward',
     (select count(*)::text
      from public.workout_runs r
      join public.profiles m on m.id = r.member_id
      join lateral (
        select coalesce(sum(item.target_sets), 0) as target,
               coalesce(sum(least(coalesce(l.amount, 0), item.target_sets)), 0) as done
        from public.session_exercises item
        left join (select session_exercise_id, count(*)::int as amount
                   from public.set_logs where run_id = r.id
                   group by session_exercise_id) l
          on l.session_exercise_id = item.id
        where item.session_id = r.session_id
      ) calc on true
      where r.ended_at is not null
        and r.outcome <> 'abandoned'
        and calc.target > 0
        and floor(30.0 * calc.done / calc.target) > 0
        and m.subscription_status not in ('suspended', 'expired')
        and (m.subscription_until is null or m.subscription_until >= current_date)
        and not exists (select 1 from public.rewards w where w.run_id = r.id)
        and not exists (
          select 1 from public.rewards w2
          where w2.member_id = r.member_id
            and w2.workout_session_id = r.session_id
            and w2.reward_day = (r.started_at at time zone 'Europe/Rome')::date)),
     '0'),

    -- `patches/023`: no points are WRITTEN while the membership is suspended or
    -- elapsed.
    --
    -- NOT an invariant either, and for the mirror-image reason: nothing
    -- retracts points already earned, and nothing sweeps `subscription_status`
    -- when `subscription_until` elapses. Lorenzo is seeded active with twelve
    -- days left, so this row starts failing on the thirteenth day of an
    -- untouched database; pressing Suspend on any member fails it at once.
    ('seed', 'rewards held by an inactive membership',
     (select count(*)::text
      from public.rewards w join public.profiles m on m.id = w.member_id
      where m.subscription_status in ('suspended', 'expired')
         or (m.subscription_until is not null
             and m.subscription_until < current_date)), '0'),

    -- The app writes exactly two shapes of code and no others.
    ('integrity', 'rewards with a code the app never generates',
     (select count(*)::text from public.rewards
      where code not like 'workout:%' and code not like 'checkin:%'), '0'),

    ('integrity', 'workout rewards missing their run, session or day',
     (select count(*)::text from public.rewards
      where code like 'workout:%'
        and (run_id is null or workout_session_id is null
             or reward_day is null)), '0'),

    -- `redeem_checkin_token` writes the check-in and the reward together, so a
    -- reward with no check-in behind it is a reward nobody earned.
    --
    -- Matched in BOTH day frames on purpose. `patches/024` stamped
    -- `reward_day = current_date`, the database's UTC day, while
    -- `close_workout_run_secure` uses the Rome day and `seed.sql` follows it --
    -- so between midnight and 02:00 Rome the two disagreed, and one check-in
    -- could pay twice in an Italian day while another paid nothing.
    -- `patches/026` fixes the writer, but rows stamped before it keep their UTC
    -- day and are not backfilled, so the tolerance stays.
    ('integrity', 'check-in rewards with no check-in that day',
     (select count(*)::text from public.rewards w
      where w.code like 'checkin:%'
        and not exists (
          select 1 from public.checkins c
          where c.member_id = w.member_id
            and ((c.created_at at time zone 'Europe/Rome')::date = w.reward_day
                 or (c.created_at at time zone 'UTC')::date = w.reward_day))),
     '0'),

    ('integrity', 'check-in rewards worth other than ten points',
     (select count(*)::text from public.rewards
      where code like 'checkin:%' and points <> 10), '0'),

    -- `create_nutrition_plan_secure` (patches/022) refuses each of these.
    ('integrity', 'nutrition plans with no day type',
     (select count(*)::text from public.nutrition_plans p
      where not exists (select 1 from public.nutrition_days d
                        where d.plan_id = p.id)), '0'),

    ('integrity', 'day types with no weekday or no meal',
     (select count(*)::text from public.nutrition_days d
      where coalesce(cardinality(d.weekdays), 0) = 0
         or not exists (select 1 from public.meals m where m.day_id = d.id)),
     '0'),

    -- The wizard stops two day types claiming the same weekday, and nothing in
    -- the schema does -- so a seeded plan can break it silently and the member
    -- gets two different menus for one Tuesday.
    ('integrity', 'weekdays claimed by two day types of one plan',
     (select count(*)::text from (
        select d.plan_id, wd
        from public.nutrition_days d, unnest(d.weekdays) wd
        group by d.plan_id, wd having count(*) > 1) bad), '0'),

    -- `messages_select` requires the member to be assigned to the thread's
    -- professional RIGHT NOW. A thread left over from an old assignment reads
    -- as an empty conversation to both parties.
    ('integrity', 'threads whose member is not assigned to that professional',
     (select count(*)::text from public.threads t
      join public.profiles m on m.id = t.member_id
      where m.role <> 'member'
         or m.assigned_pro_id is distinct from t.pro_id), '0'),

    ('integrity', 'messages sent by a non-participant',
     (select count(*)::text from public.messages msg
      join public.threads t on t.id = msg.thread_id
      where msg.sender_id <> t.member_id and msg.sender_id <> t.pro_id), '0'),

    -- What `create_appointment_secure` enforces on both of its branches.
    ('integrity', 'appointments booked with the wrong professional',
     (select count(*)::text from public.appointments a
      join public.profiles m on m.id = a.member_id
      where m.assigned_pro_id is distinct from a.pro_id), '0'),

    ('integrity', 'appointments ending before they start',
     (select count(*)::text from public.appointments
      where ends_at <= starts_at), '0'),

    -- A future DAY, not a future instant: the app lets a professional mark a
    -- slot done at any point during the day it happens on, so comparing
    -- against now() would fail a correct database whenever the demo runs
    -- earlier in the morning than today's completed appointment.
    ('integrity', 'appointments on a later day already done or cancelled',
     (select count(*)::text from public.appointments
      where starts_at >= current_date + 1
        and status in ('done', 'cancelled')), '0'),

    -- What `validate_profile_authority` (patches/015) enforces.
    ('integrity', 'members with no coach, or a coach who is not one',
     (select count(*)::text from public.profiles m
      where m.role = 'member'
        and (m.assigned_pro_id is null
             or not exists (select 1 from public.profiles p
                            where p.id = m.assigned_pro_id
                              and p.role = 'professional'))), '0'),

    ('integrity', 'professionals assigned to another professional',
     (select count(*)::text from public.profiles
      where role = 'professional' and assigned_pro_id is not null), '0'),

    ('integrity', 'profiles breaking the specialty rule',
     (select count(*)::text from public.profiles
      where (role = 'professional') <> (specialty is not null)), '0'),

    -- A plan is written either by the member themselves (patches/017) or by
    -- their assigned professional. Nobody else.
    ('integrity', 'workout plans authored by an outsider',
     (select count(*)::text from public.workout_plans p
      join public.profiles m on m.id = p.member_id
      where p.author_id is not null
        and p.author_id <> p.member_id
        and p.author_id is distinct from m.assigned_pro_id), '0'),

    ('integrity', 'nutrition plans authored by an outsider',
     (select count(*)::text from public.nutrition_plans p
      join public.profiles m on m.id = p.member_id
      where p.author_id is not null
        and p.author_id is distinct from m.assigned_pro_id), '0'),

    ('integrity', 'availability slots that end before they start',
     (select count(*)::text from public.availability
      where ends_at <= starts_at or weekday < 0 or weekday > 6), '0'),

    -- =======================================================================
    -- 3. DEMO READINESS
    -- =======================================================================
    -- Identified by email rather than by display name: renaming the cast must
    -- not be able to fail the verification.
    ('cast', 'professionals', (select count(*)::text from public.profiles
      where role = 'professional'), '2'),

    ('cast', 'members', (select count(*)::text from public.profiles
      where role = 'member'), '7'),

    -- A stale account from an old seed or a mid-demo signup shows up here.
    ('cast', 'profiles on an address other than trainhub.com',
     (select count(*)::text from public.profiles p
      join auth.users u on u.id = p.id
      where u.email not like '%@trainhub.com'), '0'),

    ('cast', 'clients of the main coach',
     (select count(*)::text from public.profiles
      where assigned_pro_id = (select id from auth.users
                               where email = 'marco@trainhub.com')), '5'),

    ('cast', 'clients of the second coach',
     (select count(*)::text from public.profiles
      where assigned_pro_id = (select id from auth.users
                               where email = 'giulia@trainhub.com')), '2'),

    -- The membership matrix. Each of these drives different behaviour in
    -- `has_active_subscription`, the badge, booking and the reward writes, so a
    -- demo that cannot show all three cannot show `patches/023` at all.
    ('cast', 'suspended members',
     (select count(*)::text from public.profiles
      where role = 'member' and subscription_status = 'suspended'), '1'),

    ('cast', 'expired members',
     (select count(*)::text from public.profiles
      where role = 'member' and subscription_status = 'expired'), '1'),

    ('cast', 'members whose subscription lapses within a fortnight',
     (select (count(*) >= 1)::text from public.profiles
      where role = 'member' and subscription_status = 'active'
        and subscription_until between current_date and current_date + 14),
     'true'),

    ('demo', 'exactly one open run in the database',
     (select count(*)::text from public.workout_runs
      where ended_at is null), '1'),

    ('demo', 'the open run belongs to the main demo member',
     (select (count(*) = 1)::text from public.workout_runs
      where ended_at is null
        and member_id = (select id from auth.users
                         where email = 'daniel@trainhub.com')), 'true'),

    -- The four session states the member's workout screen can render are
    -- derived from this week's runs, so all four have to exist this week or
    -- three of the four cards cannot be shown.
    ('demo', 'main member has a completed run this week',
     (select (count(*) >= 1)::text from public.workout_runs r
      where r.member_id = (select id from auth.users
                           where email = 'daniel@trainhub.com')
        and r.outcome = 'completed'
        and (r.started_at at time zone 'Europe/Rome')::date
            >= date_trunc('week', current_date)::date), 'true'),

    ('demo', 'main member has a partial run this week',
     (select (count(*) >= 1)::text from public.workout_runs r
      where r.member_id = (select id from auth.users
                           where email = 'daniel@trainhub.com')
        and r.outcome = 'partial'
        and (r.started_at at time zone 'Europe/Rome')::date
            >= date_trunc('week', current_date)::date), 'true'),

    ('demo', 'main member has an untouched session this week',
     (select (count(*) >= 1)::text
      from public.workout_sessions s
      join public.workout_plans p on p.id = s.plan_id
      where p.member_id = (select id from auth.users
                           where email = 'daniel@trainhub.com')
        and not exists (
          select 1 from public.workout_runs r
          where r.session_id = s.id
            and (r.started_at at time zone 'Europe/Rome')::date
                >= date_trunc('week', current_date)::date)), 'true'),

    -- `groupByMonth` renders one heading per calendar month. One month of
    -- history makes the grouping invisible.
    ('demo', 'rewards span at least two calendar months',
     (select (count(distinct to_char(earned_at, 'YYYY-MM')) >= 2)::text
      from public.rewards), 'true'),

    ('demo', 'both reward sources are present',
     (select (count(*) filter (where code like 'workout:%') > 0
              and count(*) filter (where code like 'checkin:%') > 0)::text
      from public.rewards), 'true'),

    -- `patches/017` widened plan creation to the member themselves, and no demo
    -- data had ever depicted it.
    ('demo', 'a member-authored workout plan exists',
     (select (count(*) >= 1)::text from public.workout_plans
      where author_id = member_id), 'true'),

    ('demo', 'exactly one superseded plan chain',
     (select count(*)::text from public.workout_plans
      where replaces_plan_id is not null), '1'),

    ('demo', 'appointments today',
     (select (count(*) >= 4)::text from public.appointments
      where starts_at >= current_date and starts_at < current_date + 1), 'true'),

    ('demo', 'appointments still to come',
     (select (count(*) >= 5)::text from public.appointments
      where starts_at > now()), 'true'),

    ('demo', 'every appointment kind is represented',
     (select count(distinct kind)::text from public.appointments), '3'),

    ('demo', 'every appointment status is represented',
     (select count(distinct status)::text from public.appointments), '4'),

    ('demo', 'both coaches publish availability',
     (select count(distinct pro_id)::text from public.availability), '2'),

    ('demo', 'nutrition plans',
     (select (count(*) >= 3)::text from public.nutrition_plans), 'true'),

    ('demo', 'a client with no workout plan exists',
     (select (count(*) >= 1)::text from public.profiles m
      where m.role = 'member'
        and not exists (select 1 from public.workout_plans p
                        where p.member_id = m.id)), 'true'),

    ('demo', 'chat threads',
     (select (count(*) >= 4)::text from public.threads), 'true'),

    ('demo', 'someone has unread messages',
     (select (count(*) >= 1)::text from public.messages
      where read_at is null), 'true'),

    ('demo', 'notifications were generated by the triggers',
     (select (count(*) >= 10)::text from public.notifications), 'true'),

    ('demo', 'some notifications are still unread',
     (select (count(*) >= 1)::text from public.notifications
      where read_at is null), 'true'),

    ('demo', 'exercise catalogue covers at least seven muscle groups',
     (select (count(distinct muscle_group) >= 7)::text
      from public.exercises), 'true'),

    ('demo', 'body metrics have a trend to draw',
     (select (count(*) >= 5)::text from public.body_metrics), 'true')
) as t(section, check_name, actual, expected)
order by
  case section when 'schema' then 1 when 'integrity' then 2
               when 'seed' then 3 when 'cast' then 4 else 5 end,
  check_name;
