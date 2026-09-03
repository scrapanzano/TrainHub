-- TrainHub Row Level Security.  Run after schema.sql.
-- Rule of thumb: a member reaches only their own rows; a professional reaches
-- rows belonging to members assigned to them.

alter table profiles           enable row level security;
alter table exercises          enable row level security;
alter table workout_plans      enable row level security;
alter table workout_sessions   enable row level security;
alter table session_exercises  enable row level security;
alter table set_logs           enable row level security;
alter table workout_runs       enable row level security;
alter table nutrition_plans    enable row level security;
alter table nutrition_days     enable row level security;
alter table meals              enable row level security;
alter table availability       enable row level security;
alter table appointments       enable row level security;
alter table threads            enable row level security;
alter table messages           enable row level security;
alter table rewards            enable row level security;
alter table checkins           enable row level security;
alter table checkin_tokens     enable row level security;
alter table body_metrics       enable row level security;
alter table push_subscriptions enable row level security;
alter table app_config         enable row level security;

-- SECURITY DEFINER so the helper can read `profiles` without recursing back
-- through the very policies it is being used to evaluate.
--
-- `search_path = ''` with `public.`-qualified relations, not `= public`.
-- Postgres resolves an unqualified relation through pg_temp BEFORE it walks
-- search_path, and any signed-in role may create temp tables -- so a member who
-- creates a temp `profiles` with their own id and `role = 'professional'` makes
-- these helpers, which run as their owner and bypass RLS, agree.
-- `is_professional()` gates every professional-only policy here and
-- `redeem_checkin_token()` in `patches/009`.  See `patches/011`, which repairs
-- databases created before this line was fixed.
create function is_professional() returns boolean
language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'professional'
  );
$$;

create function owns_member(target uuid) returns boolean
language sql security definer stable set search_path = '' as $$
  select target = auth.uid()
      or exists (
           select 1 from public.profiles
           where id = target and assigned_pro_id = auth.uid()
         );
$$;

-- profiles ------------------------------------------------------------------
create policy profiles_select_self on profiles
  for select using (id = auth.uid());

-- A member must be able to browse professionals in order to choose one.
-- The `auth.uid() is not null` guard is load-bearing: without it this policy
-- has no reference to the caller at all, so it grants every professional's
-- profile to anyone holding the publishable key -- which ships in the JS
-- bundle and is therefore public.
create policy profiles_select_professionals on profiles
  for select using (auth.uid() is not null and role = 'professional');

create policy profiles_select_own_clients on profiles
  for select using (assigned_pro_id = auth.uid());

create policy profiles_update_self on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- exercises -----------------------------------------------------------------
create policy exercises_select_all on exercises
  for select using (auth.uid() is not null);

create policy exercises_write_professionals on exercises
  for all using (is_professional()) with check (is_professional());

-- workout_plans -------------------------------------------------------------
create policy workout_plans_select on workout_plans
  for select using (owns_member(member_id));

-- workout_sessions ----------------------------------------------------------
create policy workout_sessions_select on workout_sessions
  for select using (
    exists (select 1 from workout_plans p
            where p.id = plan_id and owns_member(p.member_id))
  );

-- session_exercises ---------------------------------------------------------
create policy session_exercises_select on session_exercises
  for select using (
    exists (select 1 from workout_sessions s
            join workout_plans p on p.id = s.plan_id
            where s.id = session_id and owns_member(p.member_id))
  );

-- set_logs ------------------------------------------------------------------
create policy set_logs_select on set_logs
  for select using (owns_member(member_id));

-- Runs and sets are written only through patch 015's checked operations.
create policy workout_runs_select on workout_runs
  for select using (owns_member(member_id));

-- nutrition_plans -----------------------------------------------------------
create policy nutrition_plans_select on nutrition_plans
  for select using (owns_member(member_id));

-- nutrition_days --------------------------------------------------------------
create policy nutrition_days_select on nutrition_days
  for select using (
    exists (select 1 from nutrition_plans plan
            where plan.id = plan_id and owns_member(plan.member_id))
  );

-- meals ---------------------------------------------------------------------
-- Nutrition plans, their day types and their meals are professional-authored
-- and written only through create_nutrition_plan_secure (patch 022) -- see
-- report ch.1 and doc/nutrition_plan.md.
create policy meals_select on meals
  for select using (
    exists (select 1 from nutrition_days d
            join nutrition_plans plan on plan.id = d.plan_id
            where d.id = day_id and owns_member(plan.member_id))
  );

-- availability --------------------------------------------------------------
-- Readable by everyone signed in, because members need it to pick a slot.
create policy availability_select_all on availability
  for select using (auth.uid() is not null);

create policy availability_write_own on availability
  for all using (pro_id = auth.uid()) with check (pro_id = auth.uid());

-- appointments --------------------------------------------------------------
create policy appointments_select on appointments
  for select using (member_id = auth.uid() or pro_id = auth.uid());

-- threads -------------------------------------------------------------------
create policy threads_select on threads
  for select using (
    (member_id = auth.uid() or pro_id = auth.uid())
    and exists (select 1 from profiles member
                where member.id = member_id
                  and member.role = 'member'
                  and member.assigned_pro_id = pro_id)
  );

-- messages ------------------------------------------------------------------
create policy messages_select on messages
  for select using (
    exists (select 1 from threads t
            join profiles member on member.id = t.member_id
            where t.id = thread_id
              and (t.member_id = auth.uid() or t.pro_id = auth.uid())
              and member.role = 'member'
              and member.assigned_pro_id = t.pro_id)
  );

-- You may only send as yourself, and only into a thread you belong to.
create policy messages_insert on messages
  for insert with check (
    sender_id = auth.uid()
    and exists (select 1 from threads t
                join profiles member on member.id = t.member_id
                where t.id = thread_id
                  and (t.member_id = auth.uid() or t.pro_id = auth.uid())
                  and member.role = 'member'
                  and member.assigned_pro_id = t.pro_id)
  );

-- Marking a message read is the only UPDATE the app makes.
--
-- The `with check` is not decoration: an UPDATE policy with a `using` clause and
-- no `with check` makes Postgres reuse `using` for both, which permitted either
-- party to rewrite the OTHER party's message body, or to set `read_at` back to
-- null so the unread badge stuck.  `read_at is not null` closes the second half.
-- The first half is closed by the column grant in
-- patches/008-messages-update-read.sql -- Postgres checks the GRANT before it
-- evaluates any policy, so that is the gate that keeps `body` unwritable, and a
-- fresh install still needs that patch for it.
create policy messages_update_read on messages
  for update using (
    sender_id <> auth.uid()
    and exists (select 1 from threads t
                join profiles member on member.id = t.member_id
                where t.id = thread_id
                  and (t.member_id = auth.uid() or t.pro_id = auth.uid())
                  and member.role = 'member'
                  and member.assigned_pro_id = t.pro_id)
  ) with check (
    sender_id <> auth.uid()
    and read_at is not null
    and exists (select 1 from threads t
                join profiles member on member.id = t.member_id
                where t.id = thread_id
                  and (t.member_id = auth.uid() or t.pro_id = auth.uid())
                  and member.role = 'member'
                  and member.assigned_pro_id = t.pro_id)
  );

-- rewards -------------------------------------------------------------------
create policy rewards_select on rewards
  for select using (owns_member(member_id));

-- checkins ------------------------------------------------------------------
create policy checkins_select on checkins
  for select using (owns_member(member_id) or scanned_by_id = auth.uid());

-- Badge tokens can be minted and read only by their member. Redemption uses
-- patch 015's checked function; there is no direct update or delete policy.
create policy checkin_tokens_insert_self on checkin_tokens
  for insert with check (member_id = auth.uid());

create policy checkin_tokens_select_self on checkin_tokens
  for select using (member_id = auth.uid());

-- body_metrics ---------------------------------------------------------------
-- The professional measures; the member reads.  A member editing their own
-- weight would defeat the purpose of a coach recording it.
create policy body_metrics_select on body_metrics
  for select using (owns_member(member_id));

-- push_subscriptions --------------------------------------------------------
create policy push_subscriptions_all on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- app_config deliberately has no policy. RLS therefore denies every browser
-- role, and patch 010 also removes its table grants.
