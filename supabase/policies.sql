-- TrainHub Row Level Security.  Run after schema.sql.
-- Rule of thumb: a member reaches only their own rows; a professional reaches
-- rows belonging to members assigned to them.

alter table profiles           enable row level security;
alter table exercises          enable row level security;
alter table workout_plans      enable row level security;
alter table workout_sessions   enable row level security;
alter table session_exercises  enable row level security;
alter table set_logs           enable row level security;
alter table nutrition_plans    enable row level security;
alter table meals              enable row level security;
alter table availability       enable row level security;
alter table appointments       enable row level security;
alter table threads            enable row level security;
alter table messages           enable row level security;
alter table rewards            enable row level security;
alter table checkins           enable row level security;
alter table push_subscriptions enable row level security;

-- SECURITY DEFINER so the helper can read `profiles` without recursing back
-- through the very policies it is being used to evaluate.
create function is_professional() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'professional'
  );
$$;

create function owns_member(target uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select target = auth.uid()
      or exists (
           select 1 from profiles
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

create policy workout_plans_write on workout_plans
  for all using (owns_member(member_id)) with check (owns_member(member_id));

-- workout_sessions ----------------------------------------------------------
create policy workout_sessions_all on workout_sessions
  for all using (
    exists (select 1 from workout_plans p
            where p.id = plan_id and owns_member(p.member_id))
  ) with check (
    exists (select 1 from workout_plans p
            where p.id = plan_id and owns_member(p.member_id))
  );

-- session_exercises ---------------------------------------------------------
create policy session_exercises_all on session_exercises
  for all using (
    exists (select 1 from workout_sessions s
            join workout_plans p on p.id = s.plan_id
            where s.id = session_id and owns_member(p.member_id))
  ) with check (
    exists (select 1 from workout_sessions s
            join workout_plans p on p.id = s.plan_id
            where s.id = session_id and owns_member(p.member_id))
  );

-- set_logs ------------------------------------------------------------------
create policy set_logs_select on set_logs
  for select using (owns_member(member_id));

-- Only the member logs their own sets; a trainer may read but never invent them.
create policy set_logs_write_self on set_logs
  for all using (member_id = auth.uid()) with check (member_id = auth.uid());

-- nutrition_plans -----------------------------------------------------------
create policy nutrition_plans_select on nutrition_plans
  for select using (owns_member(member_id));

-- Nutrition plans are professional-authored by design (see report ch.1).
create policy nutrition_plans_write_pro on nutrition_plans
  for all using (is_professional() and owns_member(member_id))
  with check (is_professional() and owns_member(member_id));

-- meals ---------------------------------------------------------------------
create policy meals_select on meals
  for select using (
    exists (select 1 from nutrition_plans n
            where n.id = plan_id and owns_member(n.member_id))
  );

create policy meals_write_pro on meals
  for all using (
    is_professional() and exists (
      select 1 from nutrition_plans n
      where n.id = plan_id and owns_member(n.member_id))
  ) with check (
    is_professional() and exists (
      select 1 from nutrition_plans n
      where n.id = plan_id and owns_member(n.member_id))
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

create policy appointments_insert on appointments
  for insert with check (member_id = auth.uid() or pro_id = auth.uid());

create policy appointments_update on appointments
  for update using (member_id = auth.uid() or pro_id = auth.uid())
  with check (member_id = auth.uid() or pro_id = auth.uid());

-- threads -------------------------------------------------------------------
create policy threads_select on threads
  for select using (member_id = auth.uid() or pro_id = auth.uid());

create policy threads_insert on threads
  for insert with check (member_id = auth.uid() or pro_id = auth.uid());

-- messages ------------------------------------------------------------------
create policy messages_select on messages
  for select using (
    exists (select 1 from threads t
            where t.id = thread_id
              and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
  );

-- You may only send as yourself, and only into a thread you belong to.
create policy messages_insert on messages
  for insert with check (
    sender_id = auth.uid()
    and exists (select 1 from threads t
                where t.id = thread_id
                  and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
  );

create policy messages_update_read on messages
  for update using (
    exists (select 1 from threads t
            where t.id = thread_id
              and (t.member_id = auth.uid() or t.pro_id = auth.uid()))
  );

-- rewards -------------------------------------------------------------------
create policy rewards_select on rewards
  for select using (owns_member(member_id));

create policy rewards_insert_self on rewards
  for insert with check (member_id = auth.uid());

-- checkins ------------------------------------------------------------------
create policy checkins_select on checkins
  for select using (owns_member(member_id) or scanned_by_id = auth.uid());

-- Only a professional records a check-in, and only by scanning.
create policy checkins_insert_pro on checkins
  for insert with check (is_professional() and scanned_by_id = auth.uid());

-- push_subscriptions --------------------------------------------------------
create policy push_subscriptions_all on push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
