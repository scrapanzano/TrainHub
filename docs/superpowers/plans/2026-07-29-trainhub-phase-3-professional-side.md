# TrainHub Phase 3 — Professional Side Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Coach Andrea a working half of the app — today's agenda, a client roster, a client dossier, and the three editors that produce everything the member side already reads (workout plan, nutrition plan, progress) — plus a calendar with week and month views, appointment management, and weekly availability.

**Architecture:** No new architecture. Reads flow `data/` → TanStack Query → screen exactly as in Phases 1–2; writes are registered with `setMutationDefaults` under a stable key in `src/data/mutations.js` so they replay after a reload; date and status arithmetic lives in pure modules with `assert`-based self-checks. The professional's authority comes entirely from Row Level Security — `owns_member()` already grants a professional access to rows belonging to members whose `assigned_pro_id` is theirs, so almost no new policy is needed and no screen filters for security.

**Tech Stack:** React 19, React Router 8 (data router), MUI v9, TanStack Query v5 with `persistQueryClient`, Supabase JS v2, Vite 8.

## Global Constraints

- Plain JS + JSX. **No TypeScript**, no `.ts`/`.tsx` files.
- ESM only (`"type": "module"`). No `require`.
- **No new runtime dependencies.** Everything needed is already in `package.json`. If a task seems to need one, stop and report instead.
- All user-facing copy in **English**.
- MUI components and the theme in `src/theme/index.js` carry all styling. No CSS files, no inline colour literals — use `palette.*`, including the custom `palette.task.*` group.
- No test runner exists and none is added. Non-trivial pure logic ships an `assert`-based `*.selfcheck.js` run with `node <path>`, following `src/lib/format.selfcheck.js`.
- `npm run lint` must exit 0 at the end of every task.
- Commits: Conventional Commits, **no `Co-Authored-By` trailer** — the repository history is Davide's alone.
- Every screen renders sanely while loading, on error, and when empty. A blank screen is a bug.
- **Reads gate their error state on `data === undefined`, never on `isError`.** With `networkMode: 'offlineFirst'` a failed refetch leaves good cached data in place, and an error screen instead of that data is wrong for this app.
- Every Supabase read carries `.retry(navigator.onLine)`.
- Every write goes through `registerMutationDefaults` in `src/data/mutations.js` with a key from `src/lib/mutationKeys.js`. A `useMutation` whose function is passed inline is not replayable after a reload, and a rehydrated mutation with no registered default is discarded **silently**.
- Call sites must **not** pass `onSettled` to `useMutation` — `defaultMutationOptions` spreads the call site last, so it replaces the registered handler. Per-call `mutate(vars, { onSuccess })` is a different mechanism and is safe.
- Heading rule, unchanged from Phase 1: one `<h1>` per screen, section headings `<h2>`, card titles `<h3>`. Use `component=` to fix the level without changing the visual variant.
- Row Level Security governs every write. A client-side filter is not a security measure.

---

## What already exists

Do not rebuild these.

| Path | What it gives you |
|---|---|
| `src/data/workouts.js` | `fetchActivePlan`, `fetchSession`, `fetchSessionExercise`, `fetchSessionLogs`, `fetchExerciseCatalogue`, `logSet`, `setSessionStatus`, `createSession` |
| `src/data/appointments.js` | `fetchAppointmentsOnDay(memberId, dayISO)` |
| `src/data/rewards.js` | `fetchRewards`, `awardReward` |
| `src/data/mutations.js` | `registerMutationDefaults(queryClient)` |
| `src/lib/queryKeys.js` | `queryKeys`, `queryPrefixes` |
| `src/lib/mutationKeys.js` | `mutationKeys` |
| `src/lib/format.js` | `formatTimeRange`, `formatDate`, `todayISO` |
| `src/features/workout/status.js` | `sessionStatusOf`, `setProgress`, `planProgress` |
| `src/features/workout/summary.js` | `summariseSession`, `rewardProgress`, `POINTS` |
| `src/components/ScreenState.jsx` | `LoadingState`, `ErrorState`, `EmptyState` |
| `src/components/AppointmentCard.jsx` | Colour-coded appointment row |
| `src/components/SessionCard.jsx` | Session row with status dot |
| `src/features/auth/useAuth.js` | `useAuth()` → `{session, user, profile, profileError, loading, signOut}` |
| `src/layouts/AppLayout.jsx` | Role guard, sticky header, offline banner, bottom nav |

Every `/p/...` route is already declared in `src/routes/index.jsx` as a `<Placeholder />`. This phase replaces eleven of them; `/p/chat`, `/p/chat/:threadId`, `/p/scan`, `/p/profile` and `/p/profile/settings` stay placeholders for Phase 4.

Relevant schema and RLS facts (from `supabase/schema.sql` and `supabase/policies.sql`, do not re-derive):

- `owns_member(target)` is true when `target = auth.uid()` **or** when the target profile's `assigned_pro_id = auth.uid()`. It is the whole basis of the professional's read and write access.
- `profiles_select_own_clients` lets a professional select profiles where `assigned_pro_id = auth.uid()`. That is the client roster query — no extra policy needed.
- `workout_plans_write` and `workout_sessions_all` and `session_exercises_all` are all gated on `owns_member`, so a professional can create and edit a client's plan.
- `nutrition_plans_write_pro` and `meals_write_pro` additionally require `is_professional()`.
- `availability_write_own` is gated on `pro_id = auth.uid()`.
- `appointments_insert` / `appointments_update` allow either party.
- `set_logs_select` is gated on `owns_member`, so a professional can read a client's logs — but `set_logs_write_self` means they can never invent one.
- **A professional cannot update another profile.** `profiles_update_self` is the only UPDATE policy. So there is no "add a client" action anywhere in this phase; the assignment is made by the member in Phase 4 (`/m/trainer/browse`) or by the seed. The `+` button the Clients wireframe draws is therefore **not** built — see "Deviations from the wireframes".
- `workout_plans` has **two** foreign keys into `profiles` (`member_id`, `author_id`). Every PostgREST embed of it must name the constraint: `workout_plans!workout_plans_member_id_fkey ( ... )`. The same is true of `nutrition_plans` and `appointments`. An ambiguous embed fails at runtime with "Could not embed because more than one relationship was found".

## Deviations from the wireframes

Recorded here so the report can state them deliberately rather than discovering them at review.

1. **No `+` on `/p/clients`.** A professional cannot write another user's profile, so "add a client" cannot exist without a new policy that would let any professional claim any member. The `+` on `/p` and `/p/calendar` stays: it creates an appointment.
2. **`pt/10 - Progress Tracking` loses its "Latest Session Note" card.** No table holds a member-written session note and no screen in any phase writes one. The "Weekly Check-In Note" card is kept and backed by the new `body_metrics.note`, written by the professional during a check-in.
3. **`pt/09 - Nutrition Plan` loses "View Full PDF Plan".** There is no PDF, no storage bucket, and no generator. A button that downloads nothing is worse than no button.
4. **The client roster shows the professional's real clients.** The wireframe's "10 in total" is seed data; Task 1 seeds four extra demo clients so the screen is not a list of one.
5. **`pt/08 - Client Detail` loses its "Age: 28" pill.** `profiles` holds no date of birth and no phase adds one. It becomes "Member since 2026", from `created_at`, which is real.
6. **`pt/08` loses its "Call" button.** There is no phone number anywhere in the schema. Only "Chat" is built, linking to `/p/chat`, which Phase 4 fills in.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/patches/004-body-metrics.sql` | `body_metrics` table + RLS, applied to the live database |
| `supabase/patches/005-demo-clients.sql` | Four extra demo clients, their plans and today's agenda |
| `src/features/clients/subscription.js` | Pure `subscription_status` + expiry → label and colour |
| `src/features/clients/subscription.selfcheck.js` | Assertions for the above |
| `src/features/calendar/month.js` | Pure Monday-first month grid and week strip arithmetic |
| `src/features/calendar/month.selfcheck.js` | Assertions for the above |
| `src/features/progress/progress.js` | Pure weekly-training and weight-trend arithmetic |
| `src/features/progress/progress.selfcheck.js` | Assertions for the above |
| `src/data/clients.js` | Client roster and one client's profile |
| `src/data/nutrition.js` | Nutrition plan and meal reads and writes |
| `src/data/availability.js` | Weekly availability reads and writes |
| `src/data/progress.js` | Client training history and body metrics |
| `src/components/ClientCard.jsx` | One row of the client roster |
| `src/components/WeekStrip.jsx` | Seven-day horizontal date strip |
| `src/components/MonthGrid.jsx` | Full month grid with per-day activity dots |
| `src/features/workout/SessionForm.jsx` | The session-building form, shared by member and professional |
| `src/features/agenda/ProfessionalHomeScreen.jsx` | `/p` |
| `src/features/clients/ClientsScreen.jsx` | `/p/clients` |
| `src/features/clients/ClientDetailScreen.jsx` | `/p/clients/:clientId` |
| `src/features/clients/ClientWorkoutScreen.jsx` | `/p/clients/:clientId/workout` |
| `src/features/nutrition/NutritionPlanEditorScreen.jsx` | `/p/clients/:clientId/nutrition` |
| `src/features/progress/ClientProgressScreen.jsx` | `/p/clients/:clientId/progress` |
| `src/features/calendar/CalendarScreen.jsx` | `/p/calendar` |
| `src/features/calendar/AppointmentDetailScreen.jsx` | `/p/calendar/:appointmentId` |
| `src/features/calendar/NewAppointmentSheet.jsx` | Booking bottom sheet, opened from `/p` and `/p/calendar` |
| `src/features/calendar/AvailabilityScreen.jsx` | `/p/calendar/availability` |

**Modified:**

| Path | Change |
|---|---|
| `supabase/schema.sql` | Add `body_metrics` so a fresh install matches the patched database |
| `supabase/policies.sql` | Add the `body_metrics` policies for the same reason |
| `supabase/verify.sql` | Table counts 15 → 16 |
| `src/data/appointments.js` | Add `fetchAgendaOnDay`, `fetchAppointmentsInRange`, `fetchAppointment`, `createAppointment`, `setAppointmentStatus` |
| `src/data/workouts.js` | Add `createPlan`, `deleteSession` |
| `src/data/mutations.js` | Register the nine new mutations |
| `src/lib/queryKeys.js` | Add the professional-side keys and prefixes |
| `src/lib/mutationKeys.js` | Add the nine new keys |
| `src/components/AppointmentCard.jsx` | Take `person` and optional `to` instead of reading `appointment.pro` |
| `src/features/home/MemberHomeScreen.jsx` | Pass `person={appointment.pro}` |
| `src/features/workout/WorkoutBuilderScreen.jsx` | Render the extracted `SessionForm` |
| `src/routes/index.jsx` | Wire eleven real professional screens, lazily |

---

## Task 1: Database — body metrics and demo clients

**Files:**
- Create: `supabase/patches/004-body-metrics.sql`
- Create: `supabase/patches/005-demo-clients.sql`
- Modify: `supabase/schema.sql` (append the `body_metrics` table after `checkins`)
- Modify: `supabase/policies.sql` (append the `body_metrics` policies)
- Modify: `supabase/verify.sql` (three expected counts 15 → 16)

**Interfaces:**
- Consumes: nothing.
- Produces: table `body_metrics (id, member_id, recorded_by_id, measured_on, weight_kg, note, created_at)` with `unique (member_id, measured_on)`; four extra member profiles assigned to Coach Andrea.

Two patches rather than one: the table is schema the app depends on, the demo clients are content. A grader re-running the project needs the first and may not want the second.

`body_metrics.id` keeps `gen_random_uuid()` as its default and the write upserts on `(member_id, measured_on)` instead. One measurement per client per day is the real-world rule, and it also makes the write idempotent for free: a replayed offline save lands on the same row with the same values rather than stacking a second reading for the same morning.

- [ ] **Step 1: Write the body-metrics patch**

Create `supabase/patches/004-body-metrics.sql`:

```sql
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
```

- [ ] **Step 2: Mirror the table into schema.sql and policies.sql**

A patch applied to the live database that never reaches `schema.sql` means the next person to run the project from scratch gets a different database. Append to `supabase/schema.sql`, immediately after the `checkins` block and before `push_subscriptions`:

```sql
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
```

Append to `supabase/policies.sql`, after the `checkins` block:

```sql
-- body_metrics ---------------------------------------------------------------
-- The professional measures; the member reads.  A member editing their own
-- weight would defeat the purpose of a coach recording it.
create policy body_metrics_select on body_metrics
  for select using (owns_member(member_id));

create policy body_metrics_write_pro on body_metrics
  for all using (is_professional() and owns_member(member_id))
  with check (is_professional() and owns_member(member_id));
```

And add `body_metrics` to the `alter table ... enable row level security;` block at the top of `supabase/policies.sql`.

- [ ] **Step 3: Update verify.sql**

Three expected values change from `'15'` to `'16'` — `public tables`, `tables with RLS enabled`, and `tables with at least one policy`. Change nothing else in that file.

- [ ] **Step 4: Write the demo-clients patch**

Create `supabase/patches/005-demo-clients.sql`:

```sql
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
```

The counts: five clients (Daniel plus four); seven appointments today (two of the three from `seed.sql` land today, the third is two days out, plus the five here); five metrics. Elena's weights run **downwards in time** — `78.5 + w * 0.5` with `w` counting weeks *backwards*, so the oldest reading is the heaviest and the trend the screen computes is a loss.

- [ ] **Step 5: Hand off to Davide**

This task ends with a human step; no agent has database credentials. Report:

> Run these two files in the Supabase SQL editor, in order:
> 1. `supabase/patches/004-body-metrics.sql` — expect `rls_enabled = true`, `policy_count = 2`.
> 2. `supabase/patches/005-demo-clients.sql` — expect three PASS rows.
>
> Then re-run `supabase/verify.sql`; every check must still read PASS, with the three table counts now at 16.

- [ ] **Step 6: Commit**

```bash
git add supabase/
git commit -m "feat(db): add body metrics and four demo clients"
```

---

## Task 2: Subscription state and calendar date arithmetic

**Files:**
- Create: `src/features/clients/subscription.js`
- Create: `src/features/clients/subscription.selfcheck.js`
- Create: `src/features/calendar/month.js`
- Create: `src/features/calendar/month.selfcheck.js`

**Interfaces:**
- Consumes: nothing. Both modules are import-free so the self-checks run under bare Node.
- Produces:
  - `subscriptionStateOf(profile, todayISO) -> {label, color}` — `color` is a theme path usable as `sx={{ bgcolor: color }}`
  - `monthGrid(year, month) -> Array<{dateISO, day, inMonth}>` — Monday-first, always whole weeks
  - `weekStrip(anchorISO) -> Array<{dateISO, day, weekday}>` — seven entries, Monday-first, containing `anchorISO`
  - `shiftMonth(year, month, delta) -> {year, month}`
  - `monthLabel(year, month) -> 'March 2026'`
  - `WEEKDAY_INITIALS -> ['M','T','W','T','F','S','S']`

Both modules do date arithmetic in **UTC** and format by hand. `new Date('2026-03-01')` parses as UTC midnight, which is the previous day for every viewer west of Greenwich — the exact bug `formatDate` already documents in `src/lib/format.js`. A calendar is the one screen where that bug is unmissable.

- [ ] **Step 1: Write the failing subscription self-check**

Create `src/features/clients/subscription.selfcheck.js`:

```js
// Run with:  node src/features/clients/subscription.selfcheck.js
import assert from 'node:assert/strict'
import { subscriptionStateOf } from './subscription.js'

const TODAY = '2026-07-29'

// A comfortable renewal date is plain "Active".
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2027-03-31' }, TODAY),
  { label: 'Active', color: 'success.main' },
)

// Inside 30 days it becomes the amber warning the roster wireframe draws.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-08-20' }, TODAY),
  { label: 'Close to Expiring', color: 'warning.main' },
)

// The boundary is inclusive at 30 and exclusive at 31, checked from both sides
// so an off-by-one cannot pass.
assert.equal(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-08-28' }, TODAY).label,
  'Close to Expiring',
)
assert.equal(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-08-29' }, TODAY).label,
  'Active',
)

// A date that has already gone by outranks the stored status: the column is
// only correct until the day it stops being correct, and nothing sweeps it.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-07-28' }, TODAY),
  { label: 'Expired', color: 'error.main' },
)
// Today itself is still valid.
assert.equal(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: TODAY }, TODAY).label,
  'Close to Expiring',
)

// An explicit status wins over any date arithmetic.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'suspended', subscription_until: '2027-01-01' }, TODAY),
  { label: 'Suspended', color: 'task.suspended' },
)
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'expired', subscription_until: '2027-01-01' }, TODAY),
  { label: 'Expired', color: 'error.main' },
)

// No renewal date at all is an open-ended membership, not an expired one.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: null }, TODAY),
  { label: 'Active', color: 'success.main' },
)

// An unknown enum value must not crash a list of clients.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'trialling', subscription_until: null }, TODAY),
  { label: 'Active', color: 'success.main' },
)
// Neither must a missing profile.
assert.deepEqual(subscriptionStateOf(null, TODAY), { label: 'Unknown', color: 'task.suspended' })

console.log('subscription.selfcheck OK')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node src/features/clients/subscription.selfcheck.js`
Expected: `ERR_MODULE_NOT_FOUND` — `subscription.js` does not exist yet.

- [ ] **Step 3: Write subscription.js**

Create `src/features/clients/subscription.js`:

```js
// Pure mapping from a profile's subscription columns to the pill the client
// roster and the client dossier both draw.  No imports, so the self-check runs
// under bare Node.

const ACTIVE    = { label: 'Active', color: 'success.main' }
const EXPIRING  = { label: 'Close to Expiring', color: 'warning.main' }
const EXPIRED   = { label: 'Expired', color: 'error.main' }
const SUSPENDED = { label: 'Suspended', color: 'task.suspended' }
const UNKNOWN   = { label: 'Unknown', color: 'task.suspended' }

/** Whole days from `fromISO` to `toISO`, both `'YYYY-MM-DD'`. */
function daysBetween(fromISO, toISO) {
  const [fy, fm, fd] = fromISO.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = toISO.slice(0, 10).split('-').map(Number)
  // UTC on both sides so the subtraction cannot straddle a DST boundary and come
  // back 23 or 25 hours, which then rounds to the wrong number of days.
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/**
 * The membership state to show, given the stored status and the renewal date.
 *
 * `subscription_status` is a column nothing sweeps: it still reads 'active' the
 * morning after `subscription_until` passes.  So an elapsed date outranks it,
 * and only 'suspended' and 'expired' -- states a human set deliberately --
 * outrank the date in turn.
 *
 * @param {?{subscription_status: string, subscription_until: ?string}} profile
 * @param {string} todayISO `'YYYY-MM-DD'` in the viewer's local calendar.
 */
export function subscriptionStateOf(profile, todayISO) {
  if (!profile) return UNKNOWN
  if (profile.subscription_status === 'suspended') return SUSPENDED
  if (profile.subscription_status === 'expired') return EXPIRED

  const until = profile.subscription_until
  // An open-ended membership is the gym's problem, not this component's.
  if (!until) return ACTIVE

  const remaining = daysBetween(todayISO, until)
  if (remaining < 0) return EXPIRED
  if (remaining <= 30) return EXPIRING
  return ACTIVE
}
```

- [ ] **Step 4: Run the self-check**

Run: `node src/features/clients/subscription.selfcheck.js`
Expected: `subscription.selfcheck OK`

- [ ] **Step 5: Write the failing month self-check**

Create `src/features/calendar/month.selfcheck.js`:

```js
// Run with:  node src/features/calendar/month.selfcheck.js
import assert from 'node:assert/strict'
import { monthGrid, monthLabel, shiftMonth, weekStrip, WEEKDAY_INITIALS } from './month.js'

// March 2026 starts on a Sunday, so a Monday-first grid opens with six padding
// days from February.  This is the case a Sunday-first implementation gets
// wrong while looking right for most other months.
const march = monthGrid(2026, 3)
assert.equal(march.length, 42, 'six whole weeks')
assert.deepEqual(march[0], { dateISO: '2026-02-23', day: 23, inMonth: false })
assert.deepEqual(march[6], { dateISO: '2026-03-01', day: 1, inMonth: true })
assert.deepEqual(march[7], { dateISO: '2026-03-02', day: 2, inMonth: true })
assert.deepEqual(march[36], { dateISO: '2026-03-31', day: 31, inMonth: true })
assert.deepEqual(march.at(-1), { dateISO: '2026-04-05', day: 5, inMonth: false })
assert.equal(march.filter((cell) => cell.inMonth).length, 31)

// A month that both starts on a Monday and ends on a Sunday needs no padding at
// all, and must not gain a blank trailing week.
const june = monthGrid(2026, 6)
assert.equal(june.length, 35)
assert.deepEqual(june[0], { dateISO: '2026-06-01', day: 1, inMonth: true })
assert.deepEqual(june.at(-1), { dateISO: '2026-07-05', day: 5, inMonth: false })

// February in a leap year, since the whole grid hangs off the day count.
const feb2028 = monthGrid(2028, 2)
assert.equal(feb2028.filter((cell) => cell.inMonth).length, 29)
assert.ok(feb2028.some((cell) => cell.dateISO === '2028-02-29'))

// Every grid is whole weeks and strictly consecutive, with no repeated or
// skipped day across a month boundary.
for (const grid of [march, june, feb2028]) {
  assert.equal(grid.length % 7, 0)
  for (let i = 1; i < grid.length; i += 1) {
    const previous = Date.parse(`${grid[i - 1].dateISO}T00:00:00Z`)
    const current = Date.parse(`${grid[i].dateISO}T00:00:00Z`)
    assert.equal(current - previous, 86_400_000, `gap before ${grid[i].dateISO}`)
  }
}

// The strip is the week CONTAINING the anchor, not the seven days after it.
const strip = weekStrip('2026-03-31')
assert.equal(strip.length, 7)
assert.deepEqual(
  strip.map((cell) => cell.dateISO),
  ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05'],
)
assert.deepEqual(strip[0], { dateISO: '2026-03-30', day: 30, weekday: 'M' })
assert.deepEqual(strip[6], { dateISO: '2026-04-05', day: 5, weekday: 'S' })

// An anchor that is already a Monday must not shift back a week.
assert.equal(weekStrip('2026-03-30')[0].dateISO, '2026-03-30')
// Nor must a Sunday roll forward into the next one.
assert.equal(weekStrip('2026-04-05')[0].dateISO, '2026-03-30')

// Month stepping wraps the year in both directions.
assert.deepEqual(shiftMonth(2026, 3, 1), { year: 2026, month: 4 })
assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 })
assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 })
assert.deepEqual(shiftMonth(2026, 1, -13), { year: 2024, month: 12 })

assert.equal(monthLabel(2026, 3), 'March 2026')
assert.equal(monthLabel(2026, 12), 'December 2026')

assert.deepEqual(WEEKDAY_INITIALS, ['M', 'T', 'W', 'T', 'F', 'S', 'S'])

console.log('month.selfcheck OK')
```

- [ ] **Step 6: Run it and watch it fail**

Run: `node src/features/calendar/month.selfcheck.js`
Expected: `ERR_MODULE_NOT_FOUND` — `month.js` does not exist yet.

- [ ] **Step 7: Write month.js**

Create `src/features/calendar/month.js`:

```js
// Monday-first calendar arithmetic for the professional's calendar.  No
// imports, so the self-check runs under bare Node.
//
// Everything below computes in UTC and formats by hand.  `new Date('2026-03-01')`
// is UTC midnight, which renders as 28 February for every viewer west of
// Greenwich -- the same trap `formatDate` documents in src/lib/format.js.  A
// calendar is the one screen where that bug is unmissable.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_MS = 86_400_000

/**
 * Column headers, matching the Monday-first order of `monthGrid`.
 *
 * Three of the seven repeat a letter, so a cell must never rely on these alone
 * to say which day it is -- every grid cell carries an `aria-label` with the
 * full date instead.
 */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const pad = (n) => String(n).padStart(2, '0')

/** `'YYYY-MM-DD'` from a UTC timestamp. */
function isoOf(utcMs) {
  const date = new Date(utcMs)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function parseISO(dateISO) {
  const [year, month, day] = dateISO.slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** Monday = 0 … Sunday = 6.  `getUTCDay` puts Sunday at 0, which is not the grid. */
function mondayIndex(utcMs) {
  return (new Date(utcMs).getUTCDay() + 6) % 7
}

/**
 * Every cell of a month's grid, padded to whole weeks with the neighbouring
 * months' days so the grid is rectangular.
 *
 * @param {number} year
 * @param {number} month 1-12, not the 0-based one `Date` uses.
 */
export function monthGrid(year, month) {
  const first = Date.UTC(year, month - 1, 1)
  const lead = mondayIndex(first)
  const start = first - lead * DAY_MS

  // Day 0 of the next month is the last day of this one -- the only
  // leap-year-safe way to ask how long February is.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // Whole weeks only, and no blank trailing row when the month ends on a Sunday.
  const weeks = Math.ceil((lead + daysInMonth) / 7)

  return Array.from({ length: weeks * 7 }, (_unused, index) => {
    const utcMs = start + index * DAY_MS
    const date = new Date(utcMs)
    return {
      dateISO: isoOf(utcMs),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1 && date.getUTCFullYear() === year,
    }
  })
}

/** The seven days of the week CONTAINING `anchorISO`, Monday first. */
export function weekStrip(anchorISO) {
  const anchor = parseISO(anchorISO)
  const monday = anchor - mondayIndex(anchor) * DAY_MS

  return Array.from({ length: 7 }, (_unused, index) => {
    const utcMs = monday + index * DAY_MS
    return {
      dateISO: isoOf(utcMs),
      day: new Date(utcMs).getUTCDate(),
      weekday: WEEKDAY_INITIALS[index],
    }
  })
}

/** Step a year/month pair, wrapping the year in either direction. */
export function shiftMonth(year, month, delta) {
  // Absolute months, so a delta larger than twelve wraps in one step instead of
  // needing a loop, and a negative one floors the year correctly.
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

/** `'March 2026'`. */
export function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}
```

- [ ] **Step 8: Run the self-check and lint**

Run: `node src/features/calendar/month.selfcheck.js`
Expected: `month.selfcheck OK`

Run: `npm run lint`
Expected: exit 0, no output.

- [ ] **Step 9: Commit**

```bash
git add src/features/clients src/features/calendar
git commit -m "feat(pro): add subscription state and calendar date arithmetic"
```

---

## Task 3: Professional read layer — clients and agenda

**Files:**
- Create: `src/data/clients.js`
- Modify: `src/data/appointments.js` (add three reads)
- Modify: `src/lib/queryKeys.js` (add five keys, two prefixes)
- Modify: `src/components/AppointmentCard.jsx` (take `person` and optional `to`)
- Modify: `src/features/home/MemberHomeScreen.jsx` (pass `person`)

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js`.
- Produces:
  - `fetchClients(proId) -> Array<{id, full_name, avatar_url, subscription_status, subscription_until, goal}>`
  - `fetchClient(clientId) -> {id, full_name, avatar_url, bio, subscription_status, subscription_until, created_at}`
  - `fetchAgendaOnDay(proId, dayISO) -> Array<appointment & {member}>`
  - `fetchAppointmentsInRange(proId, fromISO, toISO) -> Array<appointment & {member}>`
  - `fetchAppointment(appointmentId) -> appointment & {member}`
  - `queryKeys.clients`, `queryKeys.client`, `queryKeys.agendaOnDay`, `queryKeys.agendaRange`, `queryKeys.appointment`
  - `queryPrefixes.clients`, `queryPrefixes.agenda`
  - `<AppointmentCard appointment person to />`

`AppointmentCard` currently reads `appointment.pro` directly. The professional's agenda needs the same card showing the **member**, so the card stops choosing and takes the person to render as a prop. That is a two-line change to the card plus one at the member call site — far smaller than a second near-identical card.

- [ ] **Step 1: Add the query keys**

Modify `src/lib/queryKeys.js`. Add to `queryKeys`:

```js
  clients: (proId) => ['clients', proId],
  client: (clientId) => ['client', clientId],
  agendaOnDay: (proId, dayISO) => ['agenda', proId, 'day', dayISO],
  // The calendar loads a whole month at once and filters in memory: one request
  // serves both the per-day dots and the selected day's list.
  agendaRange: (proId, fromISO, toISO) => ['agenda', proId, 'range', fromISO, toISO],
  appointment: (appointmentId) => ['appointment', appointmentId],
  nutritionPlan: (memberId) => ['nutritionPlan', memberId],
  availability: (proId) => ['availability', proId],
  bodyMetrics: (memberId) => ['bodyMetrics', memberId],
  clientTraining: (memberId) => ['clientTraining', memberId],
```

Add to `queryPrefixes`:

```js
  clients: ['clients'],
  // Both `agendaOnDay` and `agendaRange` start with 'agenda', so one prefix
  // invalidates the home agenda and every loaded calendar month together.
  agenda: ['agenda'],
  appointment: ['appointment'],
  nutritionPlan: ['nutritionPlan'],
  availability: ['availability'],
  bodyMetrics: ['bodyMetrics'],
```

The last four keys and three prefixes are used by Tasks 8, 9 and 12; they are declared here so every key in the phase lives in one place and no later task edits this file again.

- [ ] **Step 2: Write the client reads**

Create `src/data/clients.js`:

```js
import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which turns
// "offline" into seven seconds of nothing.  Retry only when the browser thinks
// there is a network.  Applied to every read below.

/**
 * The professional's client roster.
 *
 * `assigned_pro_id` is the only filter, and it is also what
 * `profiles_select_own_clients` enforces -- the filter narrows a statement RLS
 * has already made safe, it is not what makes it safe.
 *
 * The embed names its foreign key: `workout_plans` points at `profiles` twice
 * (`member_id` and `author_id`), and an unqualified embed fails at runtime with
 * "more than one relationship was found".
 */
export async function fetchClients(proId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      `id, full_name, avatar_url, subscription_status, subscription_until,
       workout_plans!workout_plans_member_id_fkey ( goal, created_at )`,
    )
    .eq('assigned_pro_id', proId)
    .order('full_name')
    .retry(navigator.onLine)

  if (error) throw error

  return (data ?? []).map(({ workout_plans: plans, ...client }) => ({
    ...client,
    // The roster prints the current goal.  PostgREST does not order embedded
    // rows, so pick the newest plan here rather than trusting insertion order.
    goal:
      [...(plans ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]?.goal ?? null,
  }))
}

/** One client's profile, for the dossier header. */
export async function fetchClient(clientId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, bio, subscription_status, subscription_until, created_at')
    .eq('id', clientId)
    .single()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}
```

- [ ] **Step 3: Add the agenda reads**

Append to `src/data/appointments.js`:

```js
// The professional's side of the same table.  The embed is the MEMBER rather
// than the professional, and the constraint is named for the same reason as
// above: `appointments` references `profiles` twice.
const AGENDA_COLUMNS =
  'id, kind, status, starts_at, ends_at, notes, member:profiles!appointments_member_id_fkey ( id, full_name, avatar_url )'

/**
 * Every appointment in the professional's day.
 *
 * Bounds built from the local day and converted by `toISOString`, exactly as
 * `fetchAppointmentsOnDay` does: comparing a `timestamptz` against a bare date
 * string compares against UTC midnight and silently drops the evening's work
 * for anyone east of Greenwich.
 */
export async function fetchAgendaOnDay(proId, dayISO) {
  const [year, month, day] = dayISO.split('-').map(Number)
  const from = new Date(year, month - 1, day, 0, 0, 0, 0)
  const to = new Date(year, month - 1, day + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(AGENDA_COLUMNS)
    .eq('pro_id', proId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Every appointment between two local calendar days, inclusive of both.
 *
 * The calendar fetches a whole visible month in one request and filters in
 * memory for the selected day: a query per day would be up to 42 requests for
 * one screen, and each one would miss the persisted cache on a different key.
 */
export async function fetchAppointmentsInRange(proId, fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split('-').map(Number)
  const [ty, tm, td] = toISO.split('-').map(Number)
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
  // One day past the end, so the last day's appointments are included.
  const to = new Date(ty, tm - 1, td + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(AGENDA_COLUMNS)
    .eq('pro_id', proId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/** One appointment, for the detail screen. */
export async function fetchAppointment(appointmentId) {
  const { data, error } = await supabase
    .from('appointments')
    .select(AGENDA_COLUMNS)
    .eq('id', appointmentId)
    .single()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}
```

- [ ] **Step 4: Teach AppointmentCard to take a person and a link**

Modify `src/components/AppointmentCard.jsx`. Change the import line to add `CardActionArea` and `Link`:

```jsx
import { Avatar, Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { Link } from 'react-router'
import { formatTimeRange } from '../lib/format.js'
```

Change the signature and destructuring:

```jsx
/**
 * One appointment row, colour-coded by kind.
 *
 * @param {object}   props
 * @param {object}   props.appointment The row.
 * @param {?object}  props.person      Whom to show: the professional on the
 *   member's screens, the member on the professional's.  The card does not
 *   choose, because the same row means a different counterpart to each side.
 * @param {?string}  props.to          Makes the whole card a link when given.
 */
export default function AppointmentCard({ appointment, person, to }) {
  const { kind, status, starts_at: startsAt, ends_at: endsAt } = appointment
```

Replace every `pro?.` with `person?.`:

```jsx
              <Avatar src={person?.avatar_url ?? undefined} sx={{ width: 20, height: 20 }}>
                {person?.full_name?.[0] ?? '?'}
              </Avatar>
              <Typography variant="body2" color="text.secondary" noWrap>
                {person?.full_name ?? 'Unassigned'}
              </Typography>
```

Wrap the existing `<CardContent>` so it becomes a link only when `to` is given. Keep the `<Card>` and its `sx` exactly as they are; the change is only what sits between `<Card>` and `<CardContent>`:

```jsx
  const body = (
    <CardContent>
      {/* ...unchanged Stack... */}
    </CardContent>
  )

  return (
    <Card sx={{ bgcolor: settled ? 'task.done' : `task.${kind}`, border: 'none' }}>
      {to ? (
        <CardActionArea component={Link} to={to}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  )
```

- [ ] **Step 5: Fix the member call site**

Modify `src/features/home/MemberHomeScreen.jsx`, in the appointments map:

```jsx
            <AppointmentCard
              key={appointment.id}
              appointment={appointment}
              person={appointment.pro}
            />
```

Without this the member's Home shows "Unassigned" under every appointment — a silent regression, since nothing throws.

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds.

Then, in the browser as the **member** (`daniel@trainhub.dev`), open `/m` and confirm each appointment card still shows "Coach Andrea" with the avatar. This is the only regression this task can cause and nothing else in the phase would catch it.

- [ ] **Step 7: Commit**

```bash
git add src/data/clients.js src/data/appointments.js src/lib/queryKeys.js src/components/AppointmentCard.jsx src/features/home/MemberHomeScreen.jsx
git commit -m "feat(pro): add client and agenda reads"
```

---

## Task 4: Professional home — today's agenda

**Files:**
- Create: `src/features/agenda/ProfessionalHomeScreen.jsx`
- Modify: `src/routes/index.jsx` (replace the `/p` index placeholder)

**Interfaces:**
- Consumes: `fetchAgendaOnDay`, `queryKeys.agendaOnDay`, `todayISO`, `AppointmentCard`, `useAuth`.
- Produces: the `/p` screen. No exports other than the default component.

Mirrors `pt/04 - Home Page`: an `h1` reading "Today", the activity count beside it, and the day's appointments as colour-coded cards. The `+` is a `Fab` that navigates to `/p/calendar?new=1`; Task 11 makes that query parameter open the booking sheet. Until then it lands on the calendar, which is a sane destination rather than a dead button — and the route already exists.

- [ ] **Step 1: Write the screen**

Create `src/features/agenda/ProfessionalHomeScreen.jsx`:

```jsx
import { Box, Fab, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchAgendaOnDay } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function ProfessionalHomeScreen() {
  const { user } = useAuth()
  const day = todayISO()

  const agenda = useQuery({
    queryKey: queryKeys.agendaOnDay(user.id, day),
    queryFn: () => fetchAgendaOnDay(user.id, day),
  })

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h1">Today</Typography>
          {/* No count until there is one: "0 activities" above a spinner states
              something the screen does not know yet. */}
          {agenda.data ? (
            <Typography variant="h3" component="span" color="text.secondary" noWrap>
              • {agenda.data.length} activities
            </Typography>
          ) : null}
        </Stack>

        <Fab
          component={Link}
          to="/p/calendar?new=1"
          color="primary"
          size="small"
          aria-label="New appointment"
        >
          <AddIcon />
        </Fab>
      </Stack>

      {agenda.isPending ? <LoadingState /> : null}

      {/* Only when there is nothing to fall back on.  With `offlineFirst` a
          failed refetch leaves the persisted answer in place, and an error
          banner above a usable agenda reads as "the app is broken" when the
          truth is "you are offline". */}
      {agenda.isError && agenda.data === undefined ? (
        <ErrorState error={agenda.error} onRetry={agenda.refetch} />
      ) : null}

      {agenda.data?.length === 0 ? (
        <EmptyState
          title="Nothing booked today"
          description="Sessions and consultations you have scheduled will appear here."
        />
      ) : null}

      <Stack spacing={2}>
        {(agenda.data ?? []).map((appointment) => (
          <AppointmentCard
            key={appointment.id}
            appointment={appointment}
            person={appointment.member}
            to={`/p/calendar/${appointment.id}`}
          />
        ))}
      </Stack>

      {/* The bottom nav is fixed; without this the last card sits under it. */}
      <Box sx={{ height: 8 }} />
    </Stack>
  )
}
```

- [ ] **Step 2: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ index: true, ...screen("Today's Agenda") }` in the `/p` children:

```jsx
      {
        index: true,
        lazy: async () => ({
          Component: (await import('../features/agenda/ProfessionalHomeScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run dev`, sign in as `andrea@trainhub.dev`, open `/p`. Expect the heading "Today • 7 activities" and seven colour-coded cards — one grey and ticked (the `done` one), the rest by kind. Each card shows the **client's** name, not Coach Andrea's. Tapping a card navigates to `/p/calendar/<id>`, which is still the placeholder until Task 11.

- [ ] **Step 4: Commit**

```bash
git add src/features/agenda src/routes/index.jsx
git commit -m "feat(pro): add today's agenda home screen"
```

---

## Task 5: Client roster

**Files:**
- Create: `src/components/ClientCard.jsx`
- Create: `src/features/clients/ClientsScreen.jsx`
- Modify: `src/routes/index.jsx` (replace the `/p/clients` placeholder)

**Interfaces:**
- Consumes: `fetchClients`, `queryKeys.clients`, `subscriptionStateOf`, `todayISO`.
- Produces: `<ClientCard client to />`; the `/p/clients` screen.

Mirrors `pt/05 - Clients`: heading with a total, a search field, then avatar rows reading "Goal • State" with a coloured dot. The search filters in memory — the roster is one professional's clients, tens of rows at most, and a server round trip per keystroke would be slower and would fail offline.

- [ ] **Step 1: Write the card**

Create `src/components/ClientCard.jsx`:

```jsx
import { Avatar, Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { Link } from 'react-router'
import { subscriptionStateOf } from '../features/clients/subscription.js'
import { todayISO } from '../lib/format.js'

export default function ClientCard({ client, to }) {
  const state = subscriptionStateOf(client, todayISO())

  return (
    <Card>
      <CardActionArea component={Link} to={to}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar src={client.avatar_url ?? undefined} sx={{ width: 48, height: 48 }}>
              {client.full_name?.[0] ?? '?'}
            </Avatar>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h3" noWrap>
                {client.full_name}
              </Typography>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                {/* The dot carries the state by hue alone, so the label sits
                    beside it and the dot itself is hidden from the reader. */}
                <Box
                  aria-hidden
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: state.color }}
                />
                <Typography variant="body2" color="text.secondary" noWrap>
                  {/* A client with no plan yet has no goal to print, and
                      "null • Active" is worse than just the state. */}
                  {[client.goal, state.label].filter(Boolean).join(' • ')}
                </Typography>
              </Stack>
            </Box>

            <ChevronRightIcon color="primary" />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
```

- [ ] **Step 2: Write the screen**

Create `src/features/clients/ClientsScreen.jsx`:

```jsx
import { useState } from 'react'
import { InputAdornment, Stack, TextField, Typography } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { useQuery } from '@tanstack/react-query'
import { fetchClients } from '../../data/clients.js'
import { queryKeys } from '../../lib/queryKeys.js'
import ClientCard from '../../components/ClientCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function ClientsScreen() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')

  const clients = useQuery({
    queryKey: queryKeys.clients(user.id),
    queryFn: () => fetchClients(user.id),
  })

  // Filtered here rather than on the server: this is one professional's roster,
  // so it is tens of rows, and a request per keystroke would be slower online
  // and would stop working entirely offline.
  const term = search.trim().toLowerCase()
  const visible = (clients.data ?? []).filter((client) =>
    term === '' ? true : client.full_name?.toLowerCase().includes(term),
  )

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="h1">Your Clients</Typography>
        {clients.data ? (
          <Typography variant="h3" component="span" color="text.secondary" noWrap>
            • {clients.data.length} in total
          </Typography>
        ) : null}
      </Stack>

      <TextField
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search Client…"
        // A placeholder is not an accessible name: it disappears the moment
        // anything is typed, and some readers never announce it at all.
        aria-label="Search clients"
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          },
        }}
      />

      {clients.isPending ? <LoadingState /> : null}

      {clients.isError && clients.data === undefined ? (
        <ErrorState error={clients.error} onRetry={clients.refetch} />
      ) : null}

      {/* Two different nothings.  "No clients yet" for a professional who is
          searching would be a lie about their roster. */}
      {clients.data?.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="Members who choose you as their professional will appear here."
        />
      ) : null}

      {clients.data?.length > 0 && visible.length === 0 ? (
        <EmptyState title="No match" description={`No client's name contains “${search.trim()}”.`} />
      ) : null}

      <Stack spacing={2}>
        {visible.map((client) => (
          <ClientCard key={client.id} client={client} to={`/p/clients/${client.id}`} />
        ))}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 3: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'clients', ...screen('Clients') }`:

```jsx
      {
        path: 'clients',
        lazy: async () => ({
          Component: (await import('../features/clients/ClientsScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: exit 0.

In the browser as Coach Andrea, open `/p/clients`. Expect "Your Clients • 5 in total" and five rows. Check the four seeded states render distinctly: Daniel and Elena green "Active", Lorenzo amber "Close to Expiring" (his subscription is one month out), Alex grey "Suspended", Pierfelice red "Expired". Type `ele` — one row survives; type `zzz` — the "No match" state appears, not "No clients yet".

- [ ] **Step 5: Commit**

```bash
git add src/components/ClientCard.jsx src/features/clients/ClientsScreen.jsx src/routes/index.jsx
git commit -m "feat(pro): add client roster with search"
```

---

## Task 6: Client dossier

**Files:**
- Create: `src/data/nutrition.js` (the read only; Task 8 adds the writes)
- Create: `src/features/clients/ClientDetailScreen.jsx`
- Modify: `src/routes/index.jsx` (replace the `/p/clients/:clientId` placeholder)

**Interfaces:**
- Consumes: `fetchClient`, `fetchActivePlan`, `planProgress`, `subscriptionStateOf`, `queryKeys.client`, `queryKeys.activePlan`, `queryKeys.nutritionPlan`.
- Produces:
  - `fetchNutritionPlan(memberId) -> {plan, meals} | null`
  - the `/p/clients/:clientId` screen.

`fetchActivePlan` is reused as-is. RLS already lets a professional read a client's plan through `owns_member`, so the member-side function works unchanged for the professional — writing a second near-identical query would only create somewhere for the two to drift apart.

Two more wireframe deviations, both forced by the schema and both worth stating in the report:

- **`pt/08` shows an "Age: 28" pill.** `profiles` has no date of birth and no phase adds one. The pill becomes "Member since 2026", from `created_at`, which is real.
- **`pt/08` shows a "Call" button.** There is no phone number anywhere in the schema. Only "Chat" is built; it links to `/p/chat`, which Phase 4 fills in.

- [ ] **Step 1: Write the nutrition read**

Create `src/data/nutrition.js`:

```js
import { supabase } from '../lib/supabase.js'

/**
 * The member's current nutrition plan and its meals.
 *
 * "Current" is the most recently created, matching `fetchActivePlan`'s rule for
 * workouts.  Returns null rather than throwing when there is none: a client
 * whose nutrition has not been written yet is an ordinary state that both the
 * dossier and the editor render as an empty one.
 */
export async function fetchNutritionPlan(memberId) {
  const { data: plan, error: planError } = await supabase
    .from('nutrition_plans')
    .select('id, name, kcal_target, protein_g, carbs_g, fat_g, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .retry(navigator.onLine)

  if (planError) throw planError
  if (!plan) return null

  const { data: meals, error: mealsError } = await supabase
    .from('meals')
    .select('id, name, time_of_day, position, items, kcal')
    .eq('plan_id', plan.id)
    .order('position')
    .retry(navigator.onLine)

  if (mealsError) throw mealsError
  return { plan, meals: meals ?? [] }
}
```

- [ ] **Step 2: Write the screen**

Create `src/features/clients/ClientDetailScreen.jsx`:

```jsx
import {
  Avatar, Box, Card, CardActionArea, CardContent, Chip, LinearProgress, Stack, Typography,
} from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import { planProgress } from '../workout/status.js'
import { subscriptionStateOf } from './subscription.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

/** One overview card: an icon, a title, a chevron, and whatever the caller shows. */
function OverviewCard({ icon, title, to, children }) {
  return (
    <Card>
      <CardActionArea component={Link} to={to}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
            <Typography variant="h3" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
              {title}
            </Typography>
            <ChevronRightIcon color="primary" />
          </Stack>
          {children ? <Box sx={{ mt: 1.5 }}>{children}</Box> : null}
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

export default function ClientDetailScreen() {
  const { clientId } = useParams()

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(clientId),
    queryFn: () => fetchNutritionPlan(clientId),
  })

  if (client.isPending) return <LoadingState />
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const state = subscriptionStateOf(client.data, todayISO())
  const progress = planProgress(plan.data?.sessions ?? [])

  // `weeks` is the plan's intended length and `created_at` is when it started,
  // so the week the client is in is derived, not stored.  Clamped at both ends:
  // a plan read on its first day is week 1, and one left running past its span
  // must not print "week 11 of 8".
  const planWeek = plan.data
    ? Math.min(
        plan.data.plan.weeks,
        Math.max(
          1,
          Math.floor((Date.now() - Date.parse(plan.data.plan.created_at)) / (7 * 86_400_000)) + 1,
        ),
      )
    : null

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center' }}>
        <Avatar src={client.data.avatar_url ?? undefined} sx={{ width: 112, height: 112 }}>
          {client.data.full_name?.[0] ?? '?'}
        </Avatar>
        <Typography variant="h1">{client.data.full_name}</Typography>

        <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
          {/* `profiles` carries no date of birth, so the wireframe's "Age" pill
              becomes the one date that does exist. */}
          <Chip
            size="small"
            label={`Member since ${String(client.data.created_at).slice(0, 4)}`}
          />
          {plan.data?.plan.goal ? (
            <Chip size="small" label={`Goal: ${plan.data.plan.goal}`} />
          ) : null}
          <Chip
            size="small"
            label={`State: ${state.label}`}
            sx={{ bgcolor: state.color, color: 'common.white' }}
          />
        </Stack>

        {/* No "Call": there is no phone number in the schema.  Chat lands on the
            thread list, which Phase 4 fills in. */}
        <Card sx={{ border: 'none', bgcolor: 'transparent' }}>
          <CardActionArea component={Link} to="/p/chat" sx={{ borderRadius: 999, px: 3, py: 1 }}>
            <Stack spacing={0.5} alignItems="center">
              <ChatBubbleOutlineIcon color="primary" />
              <Typography variant="body2">Chat</Typography>
            </Stack>
          </CardActionArea>
        </Card>
      </Stack>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Overview
        </Typography>

        <Stack spacing={2}>
          <OverviewCard
            icon={<FitnessCenterIcon />}
            title="Workout Plan"
            to={`/p/clients/${clientId}/workout`}
          >
            {/* `undefined` means not loaded yet; `null` means loaded and there
                is none.  Collapsing them shows "No plan assigned" to every
                client for the length of the first fetch. */}
            {plan.data === undefined ? (
              <Typography variant="body2" color="text.secondary">
                Loading…
              </Typography>
            ) : plan.data === null ? (
              <Typography variant="body2" color="text.secondary">
                No plan assigned yet. Tap to build one.
              </Typography>
            ) : (
              <Stack spacing={1}>
                <Typography variant="body2">{plan.data.plan.name}</Typography>
                <LinearProgress
                  variant="determinate"
                  value={progress.percent}
                  aria-label={`Plan progress: ${progress.completed} of ${progress.total} sessions completed`}
                />
                {/* aria-hidden because the bar above already announces exactly
                    this, and a reader would otherwise say it twice. */}
                <Typography variant="body2" color="text.secondary" align="center" aria-hidden>
                  Week {planWeek} of {plan.data.plan.weeks}
                </Typography>
              </Stack>
            )}
          </OverviewCard>

          <OverviewCard
            icon={<RestaurantIcon />}
            title="Nutrition Plan"
            to={`/p/clients/${clientId}/nutrition`}
          >
            {nutrition.data === undefined ? (
              <Typography variant="body2" color="text.secondary">
                Loading…
              </Typography>
            ) : nutrition.data === null ? (
              <Typography variant="body2" color="text.secondary">
                No nutrition plan yet. Tap to write one.
              </Typography>
            ) : (
              <Stack spacing={1}>
                <Typography variant="h2" component="p">
                  {nutrition.data.plan.kcal_target ?? '—'} kcal
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`P: ${nutrition.data.plan.protein_g ?? '—'}g`} />
                  <Chip size="small" label={`C: ${nutrition.data.plan.carbs_g ?? '—'}g`} />
                  <Chip size="small" label={`F: ${nutrition.data.plan.fat_g ?? '—'}g`} />
                </Stack>
              </Stack>
            )}
          </OverviewCard>

          <OverviewCard
            icon={<TrendingUpIcon />}
            title="Progress Tracking"
            to={`/p/clients/${clientId}/progress`}
          />
        </Stack>
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 3: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'clients/:clientId', ...screen('Client Detail') }`:

```jsx
      {
        path: 'clients/:clientId',
        lazy: async () => ({
          Component: (await import('../features/clients/ClientDetailScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 4: Verify**

Run: `npm run lint`
Expected: exit 0.

In the browser, open a client from `/p/clients`. Expect the avatar, name, three chips, a Chat control, and three overview cards. Daniel shows "Hypertrophy - Phase 1" with a quarter-full bar (one of four sessions completed) and "Lean Bulk" macros. Every seeded client has a plan, so to see the empty branches temporarily point the URL at a client id and delete their plan — or simply confirm the copy by reading it. The Progress card is a bare link until Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/data/nutrition.js src/features/clients/ClientDetailScreen.jsx src/routes/index.jsx
git commit -m "feat(pro): add client dossier"
```

---

## Task 7: Workout plan editor

**Files:**
- Create: `src/features/workout/SessionForm.jsx`
- Create: `src/features/clients/ClientWorkoutScreen.jsx`
- Modify: `src/features/workout/WorkoutBuilderScreen.jsx` (render the extracted form)
- Modify: `src/data/workouts.js` (add `createPlan`, `deleteSession`)
- Modify: `src/lib/mutationKeys.js` (add `createPlan`, `deleteSession`)
- Modify: `src/data/mutations.js` (register both)
- Modify: `src/routes/index.jsx` (replace the `/p/clients/:clientId/workout` placeholder)

**Interfaces:**
- Consumes: `fetchActivePlan`, `fetchExerciseCatalogue`, `createSession`, `queryPrefixes.plan`.
- Produces:
  - `createPlan({memberId, authorId, name, goal, level, weeks}) -> {id}`
  - `deleteSession({sessionId}) -> void`
  - `mutationKeys.createPlan`, `mutationKeys.deleteSession`
  - `<SessionForm catalogue onSubmit pending paused error submitLabel />`

The member's builder and the professional's editor build the same thing — a named session with prescribed exercises — so the form is extracted rather than copied. The professional's screen adds what the member's cannot: creating the plan itself, listing the sessions that exist, and deleting one.

Deleting closes a hole left open by Phase 2: `createSession` writes the session and its exercises in two statements with no transaction, so a retry can leave an empty session behind and nothing in the app could remove it.

- [ ] **Step 1: Add the two writes**

Append to `src/data/workouts.js`:

```js
/**
 * Create a workout plan for a member.
 *
 * A professional reaches this through `workout_plans_write`, which is gated on
 * `owns_member(member_id)` -- so this succeeds for their own clients and is
 * rejected by the database for anyone else's.  `author_id` records who wrote
 * it, which the member's plan screen prints.
 */
export async function createPlan({ memberId, authorId, name, goal, level, weeks }) {
  const { data, error } = await supabase
    .from('workout_plans')
    .insert({
      member_id: memberId,
      author_id: authorId,
      name,
      goal: goal || null,
      level: level || null,
      weeks,
    })
    .select('id')
    .single()

  if (error) throw error
  return data
}

/**
 * Delete one session.
 *
 * `session_exercises` and any `set_logs` beneath it cascade.  Idempotent by
 * nature: deleting a row that is already gone affects nothing and does not
 * error, which is what makes it safe to replay after a reconnect.
 */
export async function deleteSession({ sessionId }) {
  const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId)
  if (error) throw error
}
```

- [ ] **Step 2: Register both mutations**

Modify `src/lib/mutationKeys.js`:

```js
  createPlan: ['createPlan'],
  deleteSession: ['deleteSession'],
```

Modify `src/data/mutations.js` — add the imports and two registrations:

```js
import { createPlan, createSession, deleteSession, logSet, setSessionStatus } from './workouts.js'
```

```js
  queryClient.setMutationDefaults(mutationKeys.createPlan, {
    mutationFn: createPlan,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteSession, {
    mutationFn: deleteSession,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
    },
  })
```

- [ ] **Step 3: Extract the session form**

Create `src/features/workout/SessionForm.jsx` — this is the body of `WorkoutBuilderScreen` from the name field down to the submit button, with the plan lookup and the mutation lifted out to the caller:

```jsx
import { useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, IconButton, Stack, TextField, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { EmptyState } from '../../components/ScreenState.jsx'

/**
 * Build one session: a name and an ordered list of prescribed exercises.
 *
 * Shared by the member's own builder and the professional's plan editor,
 * because both produce exactly the same `createSession` payload.  The form owns
 * only its draft state; who is being written for, and what happens on success,
 * belong to the caller.
 *
 * @param {object}   props
 * @param {Array}    props.catalogue   Exercises to choose from. Never undefined.
 * @param {Function} props.onSubmit    `({name, exercises}) => void`
 * @param {boolean}  props.pending     A save is in flight.
 * @param {boolean}  props.paused      The save is parked offline.
 * @param {?Error}   props.error       The last failure, if any.
 * @param {string}   props.submitLabel Idle label for the button.
 */
export default function SessionForm({
  catalogue,
  onSubmit,
  pending = false,
  paused = false,
  error = null,
  submitLabel = 'Save session',
}) {
  const [name, setName] = useState('')
  const [rows, setRows] = useState([])
  const [picked, setPicked] = useState(null)

  const addRow = () => {
    if (!picked) return
    setRows((current) => [...current, { exercise: picked, targetSets: 3, targetReps: 10 }])
    setPicked(null)
  }

  const updateRow = (index, field, value) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [field]: Number(value) } : row)),
    )

  const removeRow = (index) => setRows((current) => current.filter((_, i) => i !== index))

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit({
      name,
      exercises: rows.map((row, index) => ({
        exerciseId: row.exercise.id,
        position: index + 1,
        targetSets: row.targetSets,
        targetReps: row.targetReps,
      })),
    })
  }

  return (
    <Stack component="form" onSubmit={handleSubmit} spacing={3}>
      <TextField
        label="Session name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Push Day"
        required
        fullWidth
      />

      <Stack direction="row" spacing={1}>
        <Autocomplete
          options={catalogue}
          getOptionLabel={(option) => option.name}
          groupBy={(option) => option.muscle_group}
          value={picked}
          onChange={(_event, value) => setPicked(value)}
          renderInput={(params) => <TextField {...params} label="Add an exercise" />}
          sx={{ flexGrow: 1 }}
        />
        <Button onClick={addRow} disabled={!picked} variant="outlined">
          Add
        </Button>
      </Stack>

      {rows.length === 0 ? (
        <EmptyState
          title="No exercises yet"
          description="Pick from the catalogue above to build the session."
        />
      ) : (
        <Stack spacing={2}>
          {rows.map((row, index) => (
            <Card key={`${row.exercise.id}-${index}`}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>
                      {row.exercise.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {row.exercise.muscle_group}
                    </Typography>
                  </Box>

                  <TextField
                    label="Sets"
                    type="number"
                    value={row.targetSets}
                    onChange={(event) => updateRow(index, 'targetSets', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 20 } }}
                    sx={{ width: 88 }}
                  />
                  <TextField
                    label="Reps"
                    type="number"
                    value={row.targetReps}
                    onChange={(event) => updateRow(index, 'targetReps', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 100 } }}
                    sx={{ width: 88 }}
                  />

                  <IconButton
                    onClick={() => removeRow(index)}
                    aria-label={`Remove ${row.exercise.name}`}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Offline the mutation pauses: `onSuccess` never runs, no error is
          raised, and the button would sit on "Saving…" forever with nothing to
          explain it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. This session is saved on your device and will be added to the plan when
          you reconnect.
        </Alert>
      ) : null}

      {/* Without this the button simply returns to its idle label and the write
          is believed to have landed. */}
      {error ? (
        <Alert severity="error">
          {error.message ?? 'The session could not be saved. Try again.'}
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={rows.length === 0 || pending}
      >
        {paused ? 'Saved offline' : pending ? 'Saving…' : submitLabel}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 4: Rewrite the member's builder to use it**

Replace the body of `src/features/workout/WorkoutBuilderScreen.jsx` below the queries with the extracted form. Everything above `addRow` stays; the state, the row handlers and the JSX go:

```jsx
import { Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchActivePlan, fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import SessionForm from './SessionForm.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function WorkoutBuilderScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const plan = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const create = useMutation({ mutationKey: mutationKeys.createSession })

  if (plan.isPending || catalogue.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }
  // Ungated, `catalogue.data` is undefined and MUI's useAutocomplete calls
  // `options.filter()` the moment the popup opens.  With no errorElement in the
  // route tree that throw replaces the whole app with the root boundary.
  if (catalogue.isError && catalogue.data === undefined) {
    return <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  }
  if (!plan.data) {
    return (
      <EmptyState
        title="No plan to add to"
        description="Your trainer has not assigned you a plan yet. Sessions belong to a plan."
      />
    )
  }

  const onSubmit = ({ name, exercises }) => {
    create.mutate(
      {
        planId: plan.data.plan.id,
        name,
        // One past the highest position in use, not `length + 1`.  The two agree
        // only while positions run contiguously from 1, and `unique (plan_id,
        // position)` rejects a reused one -- so the moment a session is deleted,
        // counting would land on a position still occupied.
        position: Math.max(0, ...plan.data.sessions.map((session) => session.position)) + 1,
        exercises,
      },
      { onSuccess: () => navigate('/m/workout', { replace: true }) },
    )
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">New session</Typography>
      <SessionForm
        catalogue={catalogue.data}
        onSubmit={onSubmit}
        pending={create.isPending}
        paused={create.isPending && create.isPaused}
        error={create.error}
      />
    </Stack>
  )
}
```

- [ ] **Step 5: Write the professional's editor**

Create `src/features/clients/ClientWorkoutScreen.jsx`:

```jsx
import { useState } from 'react'
import {
  Alert, Button, Card, CardContent, Divider, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan, fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import SessionForm from '../workout/SessionForm.jsx'
import { sessionStatusOf } from '../workout/status.js'
import { useAuth } from '../auth/useAuth.js'

const LEVELS = ['Beginner', 'Intermediate', 'Advanced']

/** The form shown when the client has no plan at all. */
function NewPlanForm({ onSubmit, pending, paused, error }) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState('Beginner')
  const [weeks, setWeeks] = useState(6)

  return (
    <Stack
      component="form"
      spacing={3}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ name, goal, level, weeks: Number(weeks) })
      }}
    >
      <TextField
        label="Plan name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Hypertrophy - Phase 1"
        required
        fullWidth
      />
      <TextField
        label="Goal"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="Hypertrophy"
        fullWidth
      />
      <TextField
        select
        label="Level"
        value={level}
        onChange={(event) => setLevel(event.target.value)}
        fullWidth
      >
        {LEVELS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Weeks"
        type="number"
        value={weeks}
        onChange={(event) => setWeeks(event.target.value)}
        slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 52 } }}
        fullWidth
      />

      {paused ? (
        <Alert severity="info">
          You are offline. The plan is saved on your device and will be created when you reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">{error.message ?? 'The plan could not be created.'}</Alert>
      ) : null}

      <Button type="submit" variant="contained" size="large" fullWidth disabled={pending}>
        {paused ? 'Saved offline' : pending ? 'Creating…' : 'Create plan'}
      </Button>
    </Stack>
  )
}

export default function ClientWorkoutScreen() {
  const { clientId } = useParams()
  const { user } = useAuth()
  const [adding, setAdding] = useState(false)

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const createPlan = useMutation({ mutationKey: mutationKeys.createPlan })
  const createSession = useMutation({ mutationKey: mutationKeys.createSession })
  const removeSession = useMutation({ mutationKey: mutationKeys.deleteSession })

  if (plan.isPending || client.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }

  const clientName = client.data?.full_name ?? 'this client'

  // No plan yet: the only thing to do is create one.  This is the case the
  // member's own builder cannot reach, and the reason this screen exists.
  if (plan.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">New plan</Typography>
        <Typography color="text.secondary">
          {clientName} has no workout plan. Create one, then add sessions to it.
        </Typography>
        <NewPlanForm
          pending={createPlan.isPending}
          paused={createPlan.isPending && createPlan.isPaused}
          error={createPlan.error}
          onSubmit={(values) =>
            createPlan.mutate({ memberId: clientId, authorId: user.id, ...values })
          }
        />
      </Stack>
    )
  }

  const sessions = plan.data.sessions

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">{plan.data.plan.name}</Typography>
        <Typography color="text.secondary">
          {[plan.data.plan.goal, plan.data.plan.level, `${plan.data.plan.weeks} weeks`]
            .filter(Boolean)
            .join(' • ')}
        </Typography>
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h2">Sessions</Typography>

        {sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="The plan exists but is empty. Add the first session below."
          />
        ) : null}

        {sessions.map((session) => (
          <Card key={session.id}>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>
                    {session.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {session.exerciseCount} exercises • {sessionStatusOf(session.status).label}
                  </Typography>
                </Stack>

                <IconButton
                  aria-label={`Delete ${session.name}`}
                  disabled={removeSession.isPending}
                  onClick={() => {
                    // A deletion cascades into the client's logged sets, so it
                    // asks first.  `confirm` rather than a dialog component:
                    // this is one destructive action on one screen, and the
                    // native prompt is already accessible and already blocking.
                    if (
                      window.confirm(
                        `Delete “${session.name}”? Any sets ${clientName} has logged in it are deleted too.`,
                      )
                    ) {
                      removeSession.mutate({ sessionId: session.id })
                    }
                  }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}

        {removeSession.isError ? (
          <Alert severity="error">
            {removeSession.error?.message ?? 'The session could not be deleted.'}
          </Alert>
        ) : null}
      </Stack>

      <Divider />

      {adding ? (
        <Stack spacing={2}>
          <Typography variant="h2">New session</Typography>

          {catalogue.isPending ? <LoadingState /> : null}
          {catalogue.isError && catalogue.data === undefined ? (
            <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
          ) : null}

          {/* Only mount the form once the catalogue is real: MUI's
              useAutocomplete calls `options.filter()` on open, and an undefined
              `options` throws through to the router's root boundary. */}
          {catalogue.data ? (
            <SessionForm
              catalogue={catalogue.data}
              pending={createSession.isPending}
              paused={createSession.isPending && createSession.isPaused}
              error={createSession.error}
              submitLabel="Add session"
              onSubmit={({ name, exercises }) =>
                createSession.mutate(
                  {
                    planId: plan.data.plan.id,
                    name,
                    position: Math.max(0, ...sessions.map((session) => session.position)) + 1,
                    exercises,
                  },
                  { onSuccess: () => setAdding(false) },
                )
              }
            />
          ) : null}

          <Button onClick={() => setAdding(false)} disabled={createSession.isPending}>
            Cancel
          </Button>
        </Stack>
      ) : (
        <Button variant="contained" size="large" fullWidth onClick={() => setAdding(true)}>
          Add a session
        </Button>
      )}
    </Stack>
  )
}
```

- [ ] **Step 6: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'clients/:clientId/workout', ...screen('Assign Workout') }`:

```jsx
      {
        path: 'clients/:clientId/workout',
        lazy: async () => ({
          Component: (await import('../features/clients/ClientWorkoutScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 7: Verify**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds.

In the browser:
1. As Coach Andrea, open a client's Workout Plan. Expect the plan header and its sessions with an exercise count and status.
2. Add a session with two exercises; it appears in the list and the client's own `/m/workout` shows it.
3. Delete it; the confirm prompt names the session, and the list loses the row.
4. **Regression check**: as Daniel, open `/m/workout/builder` and save a session. The extracted form must behave exactly as before.

- [ ] **Step 8: Commit**

```bash
git add src/features/workout/SessionForm.jsx src/features/workout/WorkoutBuilderScreen.jsx src/features/clients/ClientWorkoutScreen.jsx src/data/workouts.js src/data/mutations.js src/lib/mutationKeys.js src/routes/index.jsx
git commit -m "feat(pro): add workout plan editor"
```

---

## Task 8: Nutrition plan editor

**Files:**
- Modify: `src/data/nutrition.js` (add three writes)
- Modify: `src/lib/mutationKeys.js` (add three keys)
- Modify: `src/data/mutations.js` (register all three)
- Create: `src/features/nutrition/NutritionPlanEditorScreen.jsx`
- Modify: `src/routes/index.jsx` (replace the `/p/clients/:clientId/nutrition` placeholder)

**Interfaces:**
- Consumes: `fetchNutritionPlan`, `queryKeys.nutritionPlan`, `queryPrefixes.nutritionPlan`.
- Produces:
  - `saveNutritionPlan({id, memberId, authorId, name, kcalTarget, proteinG, carbsG, fatG}) -> {id}`
  - `saveMeal({id, planId, name, timeOfDay, position, kcal, items}) -> meal`
  - `deleteMeal({mealId}) -> void`
  - `mutationKeys.saveNutritionPlan`, `mutationKeys.saveMeal`, `mutationKeys.deleteMeal`
  - the `/p/clients/:clientId/nutrition` screen.

Mirrors `pt/09 - Nutrition Plan` in edit mode: the green summary card becomes an editable header (name, kcal, three macros), and each meal card is editable in place with its own item rows. "View Full PDF Plan" is not built — see the deviations list.

`meals.items` is `jsonb` holding `[{food, qty}]`, exactly the shape `seed.sql` writes. The editor keeps that shape rather than inventing a new one, so the member's Phase 4 nutrition screen can read either source.

- [ ] **Step 1: Add the writes**

Append to `src/data/nutrition.js`:

```js
/**
 * Create or update a nutrition plan.
 *
 * One statement for both, because the caller knows the id only when the plan
 * already exists.  `id: undefined` is dropped by supabase-js, so the insert
 * branch lets the column default fire; with an id present, `onConflict: 'id'`
 * turns it into an update.  RLS (`nutrition_plans_write_pro`) requires the
 * caller to be a professional who owns this member either way.
 */
export async function saveNutritionPlan({
  id,
  memberId,
  authorId,
  name,
  kcalTarget,
  proteinG,
  carbsG,
  fatG,
}) {
  const row = {
    member_id: memberId,
    author_id: authorId,
    name,
    kcal_target: kcalTarget ?? null,
    protein_g: proteinG ?? null,
    carbs_g: carbsG ?? null,
    fat_g: fatG ?? null,
  }
  if (id) row.id = id

  const { data, error } = await supabase
    .from('nutrition_plans')
    .upsert(row, { onConflict: 'id' })
    .select('id')
    .single()

  if (error) throw error
  return data
}

/**
 * Create or update one meal.
 *
 * `position` carries `unique (plan_id, position)`, so the caller must pass one
 * past the highest in use rather than `length + 1` -- the two agree only while
 * positions run contiguously, and they stop the first time a meal is deleted.
 */
export async function saveMeal({ id, planId, name, timeOfDay, position, kcal, items }) {
  const row = {
    plan_id: planId,
    name,
    time_of_day: timeOfDay,
    position,
    kcal: kcal ?? null,
    items: items ?? [],
  }
  if (id) row.id = id

  const { data, error } = await supabase
    .from('meals')
    .upsert(row, { onConflict: 'id' })
    .select('id, name, time_of_day, position, items, kcal')
    .single()

  if (error) throw error
  return data
}

/** Remove one meal.  Idempotent: deleting a row that is already gone is a no-op. */
export async function deleteMeal({ mealId }) {
  const { error } = await supabase.from('meals').delete().eq('id', mealId)
  if (error) throw error
}
```

- [ ] **Step 2: Register the three mutations**

Modify `src/lib/mutationKeys.js`:

```js
  saveNutritionPlan: ['saveNutritionPlan'],
  saveMeal: ['saveMeal'],
  deleteMeal: ['deleteMeal'],
```

Modify `src/data/mutations.js` — add the import and three registrations:

```js
import { deleteMeal, saveMeal, saveNutritionPlan } from './nutrition.js'
```

```js
  queryClient.setMutationDefaults(mutationKeys.saveNutritionPlan, {
    mutationFn: saveNutritionPlan,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.nutritionPlan })
    },
  })

  // Meals share a scope so replays run in insertion order.  Without it,
  // `resumePausedMutations` replays in parallel and two edits to the same meal
  // land in whichever order the network settles them -- the older one can win.
  queryClient.setMutationDefaults(mutationKeys.saveMeal, {
    mutationFn: saveMeal,
    scope: { id: 'meals' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.nutritionPlan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteMeal, {
    mutationFn: deleteMeal,
    scope: { id: 'meals' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.nutritionPlan })
    },
  })
```

- [ ] **Step 3: Write the screen**

Create `src/features/nutrition/NutritionPlanEditorScreen.jsx`:

```jsx
import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Divider, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import AddIcon from '@mui/icons-material/Add'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/** A number field that keeps '' distinct from 0 while editing. */
function NumberField({ label, value, onChange, width }) {
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', min: 0 } }}
      sx={{ width }}
    />
  )
}

// '' must not become 0: an empty macro field means "not set", and the column is
// nullable precisely so it can say so.
const toNumberOrNull = (value) => (value === '' || value === null ? null : Number(value))

/** The header card: plan name, calorie target, three macros. */
function PlanHeaderForm({ plan, onSave, pending, paused, error }) {
  const [name, setName] = useState(plan?.name ?? '')
  const [kcal, setKcal] = useState(plan?.kcal_target ?? '')
  const [protein, setProtein] = useState(plan?.protein_g ?? '')
  const [carbs, setCarbs] = useState(plan?.carbs_g ?? '')
  const [fat, setFat] = useState(plan?.fat_g ?? '')

  return (
    <Card sx={{ bgcolor: 'task.nutrition', border: 'none' }}>
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault()
            onSave({
              name,
              kcalTarget: toNumberOrNull(kcal),
              proteinG: toNumberOrNull(protein),
              carbsG: toNumberOrNull(carbs),
              fatG: toNumberOrNull(fat),
            })
          }}
        >
          <TextField
            label="Plan name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Summer Shred 2026"
            required
            fullWidth
          />

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <NumberField label="kcal" value={kcal} onChange={setKcal} width={100} />
            <NumberField label="Protein g" value={protein} onChange={setProtein} width={100} />
            <NumberField label="Carbs g" value={carbs} onChange={setCarbs} width={100} />
            <NumberField label="Fat g" value={fat} onChange={setFat} width={100} />
          </Stack>

          {paused ? (
            <Alert severity="info">
              You are offline. The plan is saved on your device and will sync when you reconnect.
            </Alert>
          ) : null}
          {error ? (
            <Alert severity="error">{error.message ?? 'The plan could not be saved.'}</Alert>
          ) : null}

          <Button type="submit" variant="contained" disabled={pending}>
            {paused ? 'Saved offline' : pending ? 'Saving…' : plan ? 'Save plan' : 'Create plan'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

/** One editable meal: name, time, calories, and its item rows. */
function MealCard({ meal, onSave, onDelete, pending }) {
  const [name, setName] = useState(meal.name)
  const [time, setTime] = useState(String(meal.time_of_day).slice(0, 5))
  const [kcal, setKcal] = useState(meal.kcal ?? '')
  const [items, setItems] = useState(Array.isArray(meal.items) ? meal.items : [])

  const updateItem = (index, field, value) =>
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    )

  return (
    <Card>
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault()
            onSave({
              id: meal.id,
              name,
              timeOfDay: time,
              position: meal.position,
              kcal: toNumberOrNull(kcal),
              // Drop rows the user added and left blank rather than writing
              // empty objects into the member's meal list.
              items: items.filter((item) => item.food?.trim()),
            })
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="Meal"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              sx={{ flexGrow: 1 }}
            />
            {/* Native time input: the platform already renders a correct,
                accessible, locale-aware picker on every target device. */}
            <TextField
              label="Time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
              sx={{ width: 130 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <NumberField label="kcal" value={kcal} onChange={setKcal} width={100} />

            <IconButton aria-label={`Delete ${meal.name}`} onClick={() => onDelete(meal.id)}>
              <DeleteOutlineIcon />
            </IconButton>
          </Stack>

          <Divider />

          {items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No items yet.
            </Typography>
          ) : null}

          {items.map((item, index) => (
            <Stack key={index} direction="row" spacing={1} alignItems="center">
              <TextField
                label="Food"
                value={item.food ?? ''}
                onChange={(event) => updateItem(index, 'food', event.target.value)}
                sx={{ flexGrow: 1 }}
              />
              <TextField
                label="Quantity"
                value={item.qty ?? ''}
                onChange={(event) => updateItem(index, 'qty', event.target.value)}
                placeholder="80 g"
                sx={{ width: 120 }}
              />
              <IconButton
                aria-label={`Remove ${item.food || 'item'}`}
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}

          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<AddIcon />}
              onClick={() => setItems((current) => [...current, { food: '', qty: '' }])}
            >
              Add item
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button type="submit" variant="contained" disabled={pending}>
              Save
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function NutritionPlanEditorScreen() {
  const { clientId } = useParams()
  const { user } = useAuth()

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(clientId),
    queryFn: () => fetchNutritionPlan(clientId),
  })

  const savePlan = useMutation({ mutationKey: mutationKeys.saveNutritionPlan })
  const saveMealMutation = useMutation({ mutationKey: mutationKeys.saveMeal })
  const removeMeal = useMutation({ mutationKey: mutationKeys.deleteMeal })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  const plan = nutrition.data?.plan ?? null
  const meals = nutrition.data?.meals ?? []

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">Nutrition Plan</Typography>
        <Typography color="text.secondary">{client.data?.full_name ?? ''}</Typography>
      </Stack>

      <PlanHeaderForm
        // Remount the form when the plan arrives or is replaced, so the fields
        // pick up the loaded values.  Without a key, useState keeps the initial
        // empty strings for the life of the component.
        key={plan?.id ?? 'new'}
        plan={plan}
        pending={savePlan.isPending}
        paused={savePlan.isPending && savePlan.isPaused}
        error={savePlan.error}
        onSave={(values) =>
          savePlan.mutate({ id: plan?.id, memberId: clientId, authorId: user.id, ...values })
        }
      />

      {/* Meals belong to a plan, so there is nothing to add them to yet. */}
      {plan === null ? (
        <EmptyState
          title="No plan yet"
          description="Create the plan above, then add the daily meals to it."
        />
      ) : (
        <Stack spacing={2}>
          <Typography variant="h2">Daily Meals</Typography>

          {meals.length === 0 ? (
            <EmptyState title="No meals yet" description="Add the first meal of the day below." />
          ) : null}

          {meals.map((meal) => (
            <MealCard
              key={meal.id}
              meal={meal}
              pending={saveMealMutation.isPending}
              onSave={(values) => saveMealMutation.mutate({ planId: plan.id, ...values })}
              onDelete={(mealId) => {
                if (window.confirm('Delete this meal?')) removeMeal.mutate({ mealId })
              }}
            />
          ))}

          {saveMealMutation.isError ? (
            <Alert severity="error">
              {saveMealMutation.error?.message ?? 'The meal could not be saved.'}
            </Alert>
          ) : null}
          {removeMeal.isError ? (
            <Alert severity="error">
              {removeMeal.error?.message ?? 'The meal could not be deleted.'}
            </Alert>
          ) : null}

          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={saveMealMutation.isPending}
            onClick={() =>
              saveMealMutation.mutate({
                planId: plan.id,
                name: 'New meal',
                timeOfDay: '12:00',
                // One past the highest in use, not `length + 1`: `unique
                // (plan_id, position)` rejects a reused one, and counting
                // collides the moment any meal has been deleted.
                position: Math.max(0, ...meals.map((meal) => meal.position)) + 1,
                kcal: null,
                items: [],
              })
            }
          >
            Add a meal
          </Button>
        </Stack>
      )}
    </Stack>
  )
}
```

- [ ] **Step 4: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'clients/:clientId/nutrition', ...screen('Nutrition Plan') }`:

```jsx
      {
        path: 'clients/:clientId/nutrition',
        lazy: async () => ({
          Component: (await import('../features/nutrition/NutritionPlanEditorScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: exit 0.

In the browser as Coach Andrea:
1. Open Daniel's nutrition plan. Expect "Lean Bulk", 2600 kcal, the three macros, and four meal cards each listing their items.
2. Change the calorie target and save; the value survives a reload.
3. Add an item to Breakfast and save; it appears in the meal.
4. Add a meal, then delete it. Confirm the list is right afterwards, and that adding another one still works — this is the position collision the comment guards against.
5. Open a client with no nutrition plan (Lorenzo). Expect the empty header form and "No plan yet"; creating the plan makes the meals section appear.

- [ ] **Step 6: Commit**

```bash
git add src/data/nutrition.js src/data/mutations.js src/lib/mutationKeys.js src/features/nutrition src/routes/index.jsx
git commit -m "feat(pro): add nutrition plan editor"
```

---

## Task 9: Progress tracking

**Files:**
- Create: `src/features/progress/progress.js`
- Create: `src/features/progress/progress.selfcheck.js`
- Create: `src/data/progress.js`
- Create: `src/features/progress/ClientProgressScreen.jsx`
- Modify: `src/lib/mutationKeys.js` (add `saveBodyMetric`)
- Modify: `src/data/mutations.js` (register it)
- Modify: `src/routes/index.jsx` (replace the `/p/clients/:clientId/progress` placeholder)

**Interfaces:**
- Consumes: `fetchActivePlan`, `queryKeys.activePlan`, `queryKeys.bodyMetrics`, `queryKeys.clientTraining`.
- Produces:
  - `weeklyTraining(logs, totalSessions, todayISO) -> {done, total, days}`
  - `weightTrend(metrics) -> {current, deltaKg, direction, measuredOn}`
  - `fetchClientTraining(memberId, sinceISO) -> Array<{performed_at, reps, weight}>`
  - `fetchBodyMetrics(memberId) -> Array<row>` newest first
  - `saveBodyMetric({memberId, recordedById, measuredOn, weightKg, note}) -> row`
  - the `/p/clients/:clientId/progress` screen.

Mirrors `pt/10 - Progress Tracking` minus the "Latest Session Note" card, which no table can fill. "This Week's Goal" counts **distinct days on which the client logged at least one set** in the last seven days, against the number of sessions in their plan. That is a real weekly training count derived from real writes; `workout_sessions` carries no date, so nothing else in the schema could answer the question.

- [ ] **Step 1: Write the failing self-check**

Create `src/features/progress/progress.selfcheck.js`:

```js
// Run with:  node src/features/progress/progress.selfcheck.js
import assert from 'node:assert/strict'
import { weeklyTraining, weightTrend } from './progress.js'

// Noon local on purpose: a timestamp near midnight lands on a different
// calendar day depending on the machine's zone, and these assertions must hold
// wherever they run.
const at = (year, month, day, hour = 12) =>
  new Date(year, month - 1, day, hour, 0, 0, 0).toISOString()

const TODAY = '2026-07-29'

// Two sets on the same day are one training day, not two.  This is the whole
// point of counting distinct days rather than logs.
const logs = [
  { performed_at: at(2026, 7, 29, 9), reps: 10, weight: 60 },
  { performed_at: at(2026, 7, 29, 10), reps: 8, weight: 60 },
  { performed_at: at(2026, 7, 27), reps: 10, weight: 80 },
  { performed_at: at(2026, 7, 23), reps: 12, weight: 40 },
  // Eight days back: outside the window, and the boundary that an off-by-one
  // would quietly include.
  { performed_at: at(2026, 7, 21), reps: 12, weight: 40 },
]

const week = weeklyTraining(logs, 4, TODAY)
assert.equal(week.done, 3)
assert.equal(week.total, 4)
assert.deepEqual(week.days, ['2026-07-23', '2026-07-27', '2026-07-29'])

// The far edge of the window is inclusive: exactly seven days back counts.
assert.equal(weeklyTraining([{ performed_at: at(2026, 7, 23) }], 4, TODAY).done, 1)
// One day further is not.
assert.equal(weeklyTraining([{ performed_at: at(2026, 7, 22) }], 4, TODAY).done, 0)

// A client who trained more days than their plan has sessions is not a bug, but
// the ring must not overflow: `done` is honest, the ratio is clamped.
const over = weeklyTraining(
  [at(2026, 7, 29), at(2026, 7, 28), at(2026, 7, 27), at(2026, 7, 26), at(2026, 7, 25)].map(
    (performed_at) => ({ performed_at }),
  ),
  3,
  TODAY,
)
assert.equal(over.done, 5)
assert.equal(over.total, 3)
assert.equal(over.days.length, 3, 'the ring never draws more dots than the plan has sessions')

// Nothing logged, and a client with no plan, both have to render.
assert.deepEqual(weeklyTraining([], 4, TODAY), { done: 0, total: 4, days: [] })
assert.deepEqual(weeklyTraining([], 0, TODAY), { done: 0, total: 0, days: [] })

// Weight: newest first, as the query returns it.  Losing weight is 'down'.
const metrics = [
  { measured_on: '2026-07-29', weight_kg: 78.5 },
  { measured_on: '2026-07-22', weight_kg: 79 },
  { measured_on: '2026-07-15', weight_kg: 79.5 },
]
assert.deepEqual(weightTrend(metrics), {
  current: 78.5,
  deltaKg: -0.5,
  direction: 'down',
  measuredOn: '2026-07-29',
})

// Gaining reads 'up'; the delta keeps its sign either way.
assert.deepEqual(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: 80 },
    { measured_on: '2026-07-22', weight_kg: 79 },
  ]),
  { current: 80, deltaKg: 1, direction: 'up', measuredOn: '2026-07-29' },
)

// Float subtraction: 78.5 - 78.4 is 0.09999999999999432 in binary floating
// point, and a screen must not print that.
assert.equal(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: 78.5 },
    { measured_on: '2026-07-22', weight_kg: 78.4 },
  ]).deltaKg,
  0.1,
)

// Identical readings are flat, not a rounding artefact in either direction.
assert.equal(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: 78.5 },
    { measured_on: '2026-07-22', weight_kg: 78.5 },
  ]).direction,
  'flat',
)

// A single reading has a current weight but no trend, and must not report 0 --
// "no change" and "nothing to compare" are different answers.
assert.deepEqual(weightTrend([{ measured_on: '2026-07-29', weight_kg: 78.5 }]), {
  current: 78.5,
  deltaKg: null,
  direction: null,
  measuredOn: '2026-07-29',
})

// A note-only check-in leaves weight_kg null; it must be skipped when looking
// for something to compare, not treated as zero kilos.
assert.deepEqual(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: null },
    { measured_on: '2026-07-22', weight_kg: 79 },
    { measured_on: '2026-07-15', weight_kg: 79.5 },
  ]),
  { current: 79, deltaKg: -0.5, direction: 'down', measuredOn: '2026-07-22' },
)

assert.deepEqual(weightTrend([]), {
  current: null,
  deltaKg: null,
  direction: null,
  measuredOn: null,
})

console.log('progress.selfcheck OK')
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node src/features/progress/progress.selfcheck.js`
Expected: `ERR_MODULE_NOT_FOUND` — `progress.js` does not exist yet.

- [ ] **Step 3: Write progress.js**

Create `src/features/progress/progress.js`:

```js
// Pure aggregation for the professional's progress screen.  No imports, so the
// self-check runs under bare Node.

const pad = (n) => String(n).padStart(2, '0')

/** The local calendar day a timestamp falls on, as `'YYYY-MM-DD'`. */
function localDayOf(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * How many days in the last week the client actually trained.
 *
 * Counted as DISTINCT days carrying at least one logged set, not as a count of
 * logs: a client who does eight sets on Monday trained once, and a per-log
 * count would show a perfect week for one session.
 *
 * `workout_sessions` has no date column, so nothing else in the schema can
 * answer "did they train on Tuesday" -- the set logs are the only evidence.
 *
 * @param {Array<{performed_at: string}>} logs
 * @param {number} totalSessions Sessions in the plan: the weekly target.
 * @param {string} todayISO `'YYYY-MM-DD'`, the local calendar today.
 */
export function weeklyTraining(logs, totalSessions, todayISO) {
  const [year, month, day] = todayISO.slice(0, 10).split('-').map(Number)
  // Inclusive seven-day window: today and the six days before it.  Compared as
  // strings, which is safe because ISO dates sort lexicographically.
  const cutoff = new Date(year, month - 1, day - 6)
  const cutoffISO = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`

  const days = [
    ...new Set(
      (logs ?? [])
        .map((log) => localDayOf(log.performed_at))
        .filter((dayISO) => dayISO >= cutoffISO && dayISO <= todayISO),
    ),
  ].sort()

  return {
    done: days.length,
    total: totalSessions,
    // The screen draws one dot per planned session, so hand back at most that
    // many.  `done` stays truthful; only the ring is clamped.
    days: days.slice(0, totalSessions),
  }
}

/**
 * The client's latest weight and how it moved since the reading before it.
 *
 * @param {Array<{measured_on: string, weight_kg: ?number}>} metrics Newest first.
 */
export function weightTrend(metrics) {
  // A check-in can be a note with no measurement, so skip the rows that carry
  // no weight rather than reading a null as zero kilos.
  const weighed = (metrics ?? []).filter((metric) => metric.weight_kg !== null && metric.weight_kg !== undefined)

  if (weighed.length === 0) {
    return { current: null, deltaKg: null, direction: null, measuredOn: null }
  }

  const current = Number(weighed[0].weight_kg)
  const measuredOn = weighed[0].measured_on

  // One reading is a weight, not a trend.  Reporting 0 would claim the client
  // held steady when nobody has measured them twice.
  if (weighed.length === 1) {
    return { current, deltaKg: null, direction: null, measuredOn }
  }

  const previous = Number(weighed[1].weight_kg)
  // One decimal: scales read to 100 g, and binary floating point otherwise
  // turns 78.5 - 78.4 into 0.09999999999999432 on the screen.
  const deltaKg = Math.round((current - previous) * 10) / 10

  return {
    current,
    deltaKg,
    direction: deltaKg === 0 ? 'flat' : deltaKg < 0 ? 'down' : 'up',
    measuredOn,
  }
}
```

- [ ] **Step 4: Run the self-check**

Run: `node src/features/progress/progress.selfcheck.js`
Expected: `progress.selfcheck OK`

- [ ] **Step 5: Write the progress reads and the check-in write**

Create `src/data/progress.js`:

```js
import { supabase } from '../lib/supabase.js'

/**
 * The client's logged sets since `sinceISO`.
 *
 * A professional reaches these through `set_logs_select`, which is gated on
 * `owns_member` -- they can read a client's training but `set_logs_write_self`
 * means they can never invent it.
 */
export async function fetchClientTraining(memberId, sinceISO) {
  const { data, error } = await supabase
    .from('set_logs')
    .select('id, performed_at, reps, weight')
    .eq('member_id', memberId)
    .gte('performed_at', sinceISO)
    .order('performed_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/** Every check-in measurement, newest first. */
export async function fetchBodyMetrics(memberId) {
  const { data, error } = await supabase
    .from('body_metrics')
    .select('id, measured_on, weight_kg, note, recorded_by_id')
    .eq('member_id', memberId)
    .order('measured_on', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Record one check-in.
 *
 * Upserts on `(member_id, measured_on)`: one measurement per client per day is
 * the real rule, and it also makes the write idempotent, so a save that pauses
 * offline and replays on reconnect lands on the same row rather than a second
 * reading for the same morning.
 */
export async function saveBodyMetric({ memberId, recordedById, measuredOn, weightKg, note }) {
  const { data, error } = await supabase
    .from('body_metrics')
    .upsert(
      {
        member_id: memberId,
        recorded_by_id: recordedById,
        measured_on: measuredOn,
        weight_kg: weightKg ?? null,
        note: note || null,
      },
      { onConflict: 'member_id,measured_on' },
    )
    .select('id, measured_on, weight_kg, note')
    .single()

  if (error) throw error
  return data
}
```

- [ ] **Step 6: Register the write**

Modify `src/lib/mutationKeys.js`:

```js
  saveBodyMetric: ['saveBodyMetric'],
```

Modify `src/data/mutations.js`:

```js
import { saveBodyMetric } from './progress.js'
```

```js
  queryClient.setMutationDefaults(mutationKeys.saveBodyMetric, {
    mutationFn: saveBodyMetric,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.bodyMetrics })
    },
  })
```

- [ ] **Step 7: Write the screen**

Create `src/features/progress/ClientProgressScreen.jsx`:

```jsx
import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Stack, TextField, Typography,
} from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { fetchBodyMetrics, fetchClientTraining } from '../../data/progress.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { formatDate, todayISO } from '../../lib/format.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import { weeklyTraining, weightTrend } from './progress.js'

/** Thirty days back, as `'YYYY-MM-DD'`. Wide enough for the week plus context. */
function thirtyDaysAgoISO() {
  const now = new Date()
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
  return then.toISOString()
}

/** One small labelled figure, as the Stats Row wireframe draws it. */
function Stat({ label, children }) {
  return (
    <Card sx={{ flexGrow: 1, minWidth: 140 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {children}
      </CardContent>
    </Card>
  )
}

export default function ClientProgressScreen() {
  const { clientId } = useParams()
  const { user } = useAuth()
  const today = todayISO()

  const [weight, setWeight] = useState('')
  const [note, setNote] = useState('')

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  const training = useQuery({
    queryKey: queryKeys.clientTraining(clientId),
    queryFn: () => fetchClientTraining(clientId, thirtyDaysAgoISO()),
  })

  const metrics = useQuery({
    queryKey: queryKeys.bodyMetrics(clientId),
    queryFn: () => fetchBodyMetrics(clientId),
  })

  const saveMetric = useMutation({ mutationKey: mutationKeys.saveBodyMetric })

  if (training.isPending || metrics.isPending) return <LoadingState />
  if (training.isError && training.data === undefined) {
    return <ErrorState error={training.error} onRetry={training.refetch} />
  }
  if (metrics.isError && metrics.data === undefined) {
    return <ErrorState error={metrics.error} onRetry={metrics.refetch} />
  }

  const week = weeklyTraining(training.data, plan.data?.sessions.length ?? 0, today)
  const trend = weightTrend(metrics.data)
  const latestNote = metrics.data.find((metric) => metric.note)

  const savedOffline = saveMetric.isPending && saveMetric.isPaused

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Progress Tracking</Typography>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Workout Tracking
        </Typography>

        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="h3" sx={{ flexGrow: 1 }}>
                This Week&rsquo;s Goal
              </Typography>
              <Typography variant="body2" color="primary">
                {week.done}/{week.total} Sessions
              </Typography>
            </Stack>

            {week.total === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No plan assigned, so there is no weekly target yet.
              </Typography>
            ) : (
              // The dots repeat what the count above already says, so they are
              // decoration: hidden from readers rather than announced as a row
              // of unlabelled shapes.
              <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} aria-hidden>
                {Array.from({ length: week.total }, (_unused, index) => (
                  <Box
                    key={index}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      bgcolor: index < week.days.length ? 'primary.main' : 'action.disabledBackground',
                    }}
                  />
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Body &amp; Nutrition Check-in
        </Typography>

        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
            <Stat label="Current Weight">
              <Typography variant="h2" component="p">
                {trend.current === null ? '—' : `${trend.current} kg`}
              </Typography>
            </Stat>

            <Stat label="Weekly Trend">
              {trend.deltaKg === null ? (
                <Typography variant="h2" component="p" color="text.secondary">
                  —
                </Typography>
              ) : (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {trend.direction === 'down' ? (
                    <ArrowDownwardIcon color="success" titleAccess="Down" />
                  ) : trend.direction === 'up' ? (
                    <ArrowUpwardIcon color="warning" titleAccess="Up" />
                  ) : null}
                  <Typography
                    variant="h2"
                    component="p"
                    color={trend.direction === 'down' ? 'success.main' : 'text.primary'}
                  >
                    {trend.deltaKg > 0 ? '+' : ''}
                    {trend.deltaKg} kg
                  </Typography>
                </Stack>
              )}
            </Stat>
          </Stack>

          {latestNote ? (
            <Card sx={{ borderColor: 'success.main' }}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="baseline">
                  <Typography variant="h3" sx={{ flexGrow: 1 }}>
                    Weekly Check-In Note
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatDate(latestNote.measured_on)}
                  </Typography>
                </Stack>
                <Typography sx={{ mt: 1, fontStyle: 'italic' }}>
                  &ldquo;{latestNote.note}&rdquo;
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              title="No check-in notes yet"
              description="Record a measurement below to start the history."
            />
          )}
        </Stack>
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Record today&rsquo;s check-in
        </Typography>

        <Card>
          <CardContent>
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault()
                saveMetric.mutate(
                  {
                    memberId: clientId,
                    recordedById: user.id,
                    measuredOn: today,
                    weightKg: weight === '' ? null : Number(weight),
                    note,
                  },
                  {
                    onSuccess: () => {
                      setWeight('')
                      setNote('')
                    },
                  },
                )
              }}
            >
              <TextField
                label="Weight (kg)"
                type="number"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                slotProps={{ htmlInput: { inputMode: 'decimal', step: 0.1, min: 20, max: 400 } }}
                fullWidth
              />
              <TextField
                label="Note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Diet adherence, energy, sleep…"
                multiline
                minRows={2}
                fullWidth
              />

              {savedOffline ? (
                <Alert severity="info">
                  You are offline. This check-in is saved on your device and will sync when you
                  reconnect.
                </Alert>
              ) : null}
              {saveMetric.isError ? (
                <Alert severity="error">
                  {saveMetric.error?.message ?? 'The check-in could not be saved.'}
                </Alert>
              ) : null}

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={saveMetric.isPending || (weight === '' && note.trim() === '')}
              >
                {savedOffline ? 'Saved offline' : saveMetric.isPending ? 'Saving…' : 'Save check-in'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 8: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'clients/:clientId/progress', ...screen('Progress Tracking') }`:

```jsx
      {
        path: 'clients/:clientId/progress',
        lazy: async () => ({
          Component: (await import('../features/progress/ClientProgressScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 9: Verify**

Run: `node src/features/progress/progress.selfcheck.js`
Expected: `progress.selfcheck OK`

Run: `npm run lint`
Expected: exit 0.

In the browser as Coach Andrea, open Elena's progress. Expect "78.5 kg", a green "-0.5 kg" with a downward arrow, and her seeded check-in note. Save a check-in with a weight for today; the current weight updates and re-saving the same day overwrites rather than adding a row — that is the upsert doing its job. Open a client with no metrics (Alex): expect "—" in both stats and the empty note state, with the form still usable.

- [ ] **Step 10: Commit**

```bash
git add src/features/progress src/data/progress.js src/data/mutations.js src/lib/mutationKeys.js src/routes/index.jsx
git commit -m "feat(pro): add client progress tracking"
```

---

## Task 10: Calendar with week and month views

**Files:**
- Create: `src/components/WeekStrip.jsx`
- Create: `src/components/MonthGrid.jsx`
- Create: `src/features/calendar/CalendarScreen.jsx`
- Modify: `src/routes/index.jsx` (replace the `/p/calendar` placeholder)

**Interfaces:**
- Consumes: `monthGrid`, `weekStrip`, `shiftMonth`, `monthLabel`, `WEEKDAY_INITIALS`, `fetchAppointmentsInRange`, `queryKeys.agendaRange`.
- Produces:
  - `<WeekStrip days selected onSelect markers />`
  - `<MonthGrid cells selected onSelect markers />`
  - the `/p/calendar` screen.

Mirrors `pt/06` (collapsed) and `pt/06B` (expanded): a month label with a chevron that toggles between them, arrows to step months, a `+` for a new appointment, then the selected day's appointments below.

**One query serves the whole screen.** The visible month's grid is always whole weeks, so its first and last cells bound every day either view can show — the week strip is a row of that same grid. Fetching that one range gives both the per-day dots and the selected day's list, instead of up to 42 requests that would each miss the persisted cache on a different key.

- [ ] **Step 1: Write the week strip**

Create `src/components/WeekStrip.jsx`:

```jsx
import { Box, ButtonBase, Stack, Typography } from '@mui/material'

/**
 * Seven selectable days.
 *
 * @param {object}   props
 * @param {Array}    props.days     From `weekStrip()`: `{dateISO, day, weekday}`.
 * @param {string}   props.selected `'YYYY-MM-DD'`.
 * @param {Function} props.onSelect `(dateISO) => void`
 * @param {object}   props.markers  `{[dateISO]: 'training'|'protocol'|'nutrition'}`
 */
export default function WeekStrip({ days, selected, onSelect, markers = {} }) {
  return (
    <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', pb: 1 }}>
      {days.map((cell) => {
        const isSelected = cell.dateISO === selected
        return (
          <ButtonBase
            key={cell.dateISO}
            onClick={() => onSelect(cell.dateISO)}
            // The single-letter weekday repeats three times a week and the
            // number alone does not say which month, so the button carries the
            // full date as its accessible name.
            aria-label={cell.dateISO}
            aria-current={isSelected ? 'date' : undefined}
            sx={{
              flex: '0 0 auto',
              width: 52,
              borderRadius: 3,
              py: 1,
              bgcolor: isSelected ? 'primary.main' : 'background.paper',
              color: isSelected ? 'primary.contrastText' : 'text.primary',
              border: 1,
              borderColor: 'divider',
            }}
          >
            <Stack alignItems="center" spacing={0.25} sx={{ width: '100%' }}>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {cell.weekday}
              </Typography>
              <Typography variant="h3" component="span">
                {cell.day}
              </Typography>
              {/* Decoration: the day's own list below states what is booked. */}
              <Box
                aria-hidden
                sx={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  bgcolor: markers[cell.dateISO] ? `task.${markers[cell.dateISO]}` : 'transparent',
                }}
              />
            </Stack>
          </ButtonBase>
        )
      })}
    </Stack>
  )
}
```

- [ ] **Step 2: Write the month grid**

Create `src/components/MonthGrid.jsx`:

```jsx
import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { WEEKDAY_INITIALS } from '../features/calendar/month.js'

/**
 * A whole month, Monday first, with a dot on every day that has something on it.
 *
 * @param {object}   props
 * @param {Array}    props.cells    From `monthGrid()`: `{dateISO, day, inMonth}`.
 * @param {string}   props.selected `'YYYY-MM-DD'`.
 * @param {Function} props.onSelect `(dateISO) => void`
 * @param {object}   props.markers  `{[dateISO]: 'training'|'protocol'|'nutrition'}`
 */
export default function MonthGrid({ cells, selected, onSelect, markers = {} }) {
  return (
    <Box>
      <Box
        aria-hidden
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.5 }}
      >
        {WEEKDAY_INITIALS.map((initial, index) => (
          <Typography
            // Three of the seven initials repeat, so the index is the key.
            key={index}
            variant="body2"
            color="text.secondary"
            align="center"
          >
            {initial}
          </Typography>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', rowGap: 0.5 }}>
        {cells.map((cell) => {
          const isSelected = cell.dateISO === selected
          return (
            <ButtonBase
              key={cell.dateISO}
              onClick={() => onSelect(cell.dateISO)}
              aria-label={cell.dateISO}
              aria-current={isSelected ? 'date' : undefined}
              sx={{ borderRadius: '50%', py: 0.5, flexDirection: 'column' }}
            >
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: isSelected ? 'primary.main' : 'transparent',
                  color: isSelected
                    ? 'primary.contrastText'
                    : // A padding day belongs to a neighbouring month: still
                      // reachable, but visibly not part of this one.
                      cell.inMonth
                      ? 'text.primary'
                      : 'text.secondary',
                  opacity: cell.inMonth || isSelected ? 1 : 0.5,
                }}
              >
                <Typography variant="body2">{cell.day}</Typography>
              </Box>
              <Box
                aria-hidden
                sx={{
                  width: 5,
                  height: 5,
                  mt: 0.25,
                  borderRadius: '50%',
                  bgcolor: markers[cell.dateISO] ? `task.${markers[cell.dateISO]}` : 'transparent',
                }}
              />
            </ButtonBase>
          )
        })}
      </Box>
    </Box>
  )
}
```

- [ ] **Step 3: Write the calendar screen**

Create `src/features/calendar/CalendarScreen.jsx`:

```jsx
import { useState } from 'react'
import { Box, Fab, IconButton, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { fetchAppointmentsInRange } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import MonthGrid from '../../components/MonthGrid.jsx'
import WeekStrip from '../../components/WeekStrip.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import NewAppointmentSheet from './NewAppointmentSheet.jsx'
import { monthGrid, monthLabel, shiftMonth, weekStrip } from './month.js'

export default function CalendarScreen() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [selected, setSelected] = useState(todayISO())
  const [expanded, setExpanded] = useState(false)

  // The visible month follows the selected day, so tapping a padding cell moves
  // the grid to the month that day belongs to without any extra state.
  const [year, month] = selected.split('-').map(Number)
  const cells = monthGrid(year, month)

  // The grid is always whole weeks, so its ends bound every day either view can
  // show -- including a week strip that straddles a month boundary.  One query
  // therefore serves the dots and the day's list in both views.
  const rangeFrom = cells[0].dateISO
  const rangeTo = cells.at(-1).dateISO

  const appointments = useQuery({
    queryKey: queryKeys.agendaRange(user.id, rangeFrom, rangeTo),
    queryFn: () => fetchAppointmentsInRange(user.id, rangeFrom, rangeTo),
  })

  // One marker colour per day: the first appointment's kind.  A day can hold
  // several kinds, and a 5px dot cannot say so -- the list below can.
  const markers = {}
  for (const appointment of appointments.data ?? []) {
    const dayISO = new Date(appointment.starts_at).toLocaleDateString('sv-SE')
    if (!markers[dayISO]) markers[dayISO] = appointment.kind
  }

  const onDay = (appointments.data ?? []).filter(
    (appointment) => new Date(appointment.starts_at).toLocaleDateString('sv-SE') === selected,
  )

  const step = (delta) => {
    const next = shiftMonth(year, month, delta)
    const lastDay = monthGrid(next.year, next.month).filter((cell) => cell.inMonth).at(-1)
    const [, , day] = selected.split('-').map(Number)
    // Keep the day of the month where it exists, and clamp where it does not --
    // stepping back from 31 March must land on 28 February, not 3 March.
    const target = Math.min(day, lastDay.day)
    setSelected(`${next.year}-${String(next.month).padStart(2, '0')}-${String(target).padStart(2, '0')}`)
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h1" sx={{ minWidth: 0 }} noWrap>
          {monthLabel(year, month)}
        </Typography>

        <IconButton
          onClick={() => setExpanded((current) => !current)}
          aria-label={expanded ? 'Show the week' : 'Show the whole month'}
          aria-expanded={expanded}
        >
          {expanded ? <ExpandLessIcon color="primary" /> : <ExpandMoreIcon color="primary" />}
        </IconButton>

        <Box sx={{ flexGrow: 1 }} />

        <IconButton onClick={() => step(-1)} aria-label="Previous month">
          <ChevronLeftIcon color="primary" />
        </IconButton>
        <IconButton onClick={() => step(1)} aria-label="Next month">
          <ChevronRightIcon color="primary" />
        </IconButton>

        <Fab
          color="primary"
          size="small"
          aria-label="New appointment"
          onClick={() => setSearchParams({ new: '1' })}
        >
          <AddIcon />
        </Fab>
      </Stack>

      {expanded ? (
        <MonthGrid cells={cells} selected={selected} onSelect={setSelected} markers={markers} />
      ) : (
        <WeekStrip
          days={weekStrip(selected)}
          selected={selected}
          onSelect={setSelected}
          markers={markers}
        />
      )}

      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="h2">{selected === todayISO() ? 'Today' : selected}</Typography>
        {appointments.data ? (
          <Typography variant="h3" component="span" color="text.secondary">
            • {onDay.length} activities
          </Typography>
        ) : null}
      </Stack>

      {appointments.isPending ? <LoadingState /> : null}

      {appointments.isError && appointments.data === undefined ? (
        <ErrorState error={appointments.error} onRetry={appointments.refetch} />
      ) : null}

      {appointments.data && onDay.length === 0 ? (
        <EmptyState title="Nothing booked" description="This day is free." />
      ) : null}

      <Stack spacing={2}>
        {onDay.map((appointment) => (
          <AppointmentCard
            key={appointment.id}
            appointment={appointment}
            person={appointment.member}
            to={`/p/calendar/${appointment.id}`}
          />
        ))}
      </Stack>

      <NewAppointmentSheet
        open={searchParams.get('new') === '1'}
        // `replace` so closing the sheet does not leave a history entry that
        // Back would use to reopen it.
        onClose={() => setSearchParams({}, { replace: true })}
        defaultDayISO={selected}
      />
    </Stack>
  )
}
```

`new Date(...).toLocaleDateString('sv-SE')` is the shortest correct way to get a **local** `YYYY-MM-DD` from a timestamp: Swedish locale formatting is ISO 8601. It is used rather than `toISOString().slice(0,10)`, which would give the UTC day and put a 23:00 appointment on the wrong date for anyone east of Greenwich.

- [ ] **Step 4: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'calendar', ...screen('Calendar') }`:

```jsx
      {
        path: 'calendar',
        lazy: async () => ({
          Component: (await import('../features/calendar/CalendarScreen.jsx')).default,
        }),
      },
```

This task imports `NewAppointmentSheet`, which Task 11 creates. Implement Tasks 10 and 11 back to back, or stub the sheet as `export default function NewAppointmentSheet() { return null }` until Task 11 replaces it — the screen will not build otherwise.

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: exit 0.

In the browser as Coach Andrea, open `/p/calendar`. Expect the current month's label, the week strip with today highlighted, and today's appointments below. Then:
- Tap the chevron: the grid expands to the whole month with dots on the days that have appointments, and collapses again.
- Step back and forward a month: the label and grid follow, and the day list empties for a month with nothing in it.
- **Step from 31 March to February** and confirm the selection lands on 28 (or 29 in a leap year), not on 3 March.
- Tap a greyed padding day at the start of the grid: the month follows it.

- [ ] **Step 6: Commit**

```bash
git add src/components/WeekStrip.jsx src/components/MonthGrid.jsx src/features/calendar/CalendarScreen.jsx src/routes/index.jsx
git commit -m "feat(pro): add calendar with week and month views"
```

---

## Task 11: Appointment detail and booking

**Files:**
- Modify: `src/data/appointments.js` (add two writes)
- Modify: `src/lib/mutationKeys.js` (add two keys)
- Modify: `src/data/mutations.js` (register both)
- Create: `src/features/calendar/NewAppointmentSheet.jsx`
- Create: `src/features/calendar/AppointmentDetailScreen.jsx`
- Modify: `src/routes/index.jsx` (replace the `/p/calendar/:appointmentId` placeholder)

**Interfaces:**
- Consumes: `fetchAppointment`, `fetchClients`, `queryKeys.appointment`, `queryPrefixes.agenda`, `queryPrefixes.appointment`.
- Produces:
  - `createAppointment({id, memberId, proId, kind, startsAt, endsAt, notes}) -> row`
  - `setAppointmentStatus({appointmentId, status}) -> row`
  - `mutationKeys.createAppointment`, `mutationKeys.setAppointmentStatus`
  - `<NewAppointmentSheet open onClose defaultDayISO />`
  - the `/p/calendar/:appointmentId` screen.

`createAppointment` takes a **client-generated `id`**, exactly as `logSet` does, and upserts with `ignoreDuplicates`. The column has a default, but a write whose response never arrives is replayed by `resumePausedMutations`, and a plain insert would then book the same slot twice.

- [ ] **Step 1: Add the writes**

Append to `src/data/appointments.js`:

```js
/**
 * Book one appointment.
 *
 * The caller supplies `id`.  The column has a default, but this write can pause
 * offline and be replayed on reconnect, and a replay of a write whose response
 * was lost would otherwise book the same slot a second time.  Upserting on the
 * client's id makes the replay a no-op.
 */
export async function createAppointment({
  id,
  memberId,
  proId,
  kind,
  status = 'confirmed',
  startsAt,
  endsAt,
  notes,
}) {
  const { data, error } = await supabase
    .from('appointments')
    .upsert(
      {
        id,
        member_id: memberId,
        pro_id: proId,
        kind,
        status,
        starts_at: startsAt,
        ends_at: endsAt,
        notes: notes || null,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success.
  return data
}

/** Move an appointment between `pending`, `confirmed`, `cancelled` and `done`. */
export async function setAppointmentStatus({ appointmentId, status }) {
  const { data, error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId)
    .select('id, status')
    .single()

  if (error) throw error
  return data
}
```

- [ ] **Step 2: Register both**

Modify `src/lib/mutationKeys.js`:

```js
  createAppointment: ['createAppointment'],
  setAppointmentStatus: ['setAppointmentStatus'],
```

Modify `src/data/mutations.js`:

```js
import { createAppointment, setAppointmentStatus } from './appointments.js'
```

```js
  queryClient.setMutationDefaults(mutationKeys.createAppointment, {
    mutationFn: createAppointment,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.agenda })
    },
  })

  // Scoped so replays run serially.  Two status changes to the same appointment
  // -- confirm then complete -- replayed in parallel land in whichever order the
  // network settles them, and the earlier one can win.
  queryClient.setMutationDefaults(mutationKeys.setAppointmentStatus, {
    mutationFn: setAppointmentStatus,
    scope: { id: 'appointmentStatus' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.agenda })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.appointment })
    },
  })
```

- [ ] **Step 3: Write the booking sheet**

Create `src/features/calendar/NewAppointmentSheet.jsx`:

```jsx
import { useState } from 'react'
import {
  Alert, Button, Drawer, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchClients } from '../../data/clients.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

const KINDS = [
  { value: 'training', label: 'Personal Training' },
  { value: 'protocol', label: 'Protocol Consultation' },
  { value: 'nutrition', label: 'Nutrition Consultation' },
]

const DURATIONS = [30, 45, 60, 90, 120]

/** `'2026-07-29'` + `'14:00'` + 60 → two ISO timestamps in the local zone. */
function slotToISO(dayISO, timeHHMM, minutes) {
  const [year, month, day] = dayISO.split('-').map(Number)
  const [hour, minute] = timeHHMM.split(':').map(Number)
  // Built from local parts so "14:00" means the professional's two o'clock.
  const start = new Date(year, month - 1, day, hour, minute, 0, 0)
  const end = new Date(start.getTime() + minutes * 60_000)
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}

export default function NewAppointmentSheet({ open, onClose, defaultDayISO }) {
  const { user } = useAuth()

  const [memberId, setMemberId] = useState('')
  const [kind, setKind] = useState('training')
  const [day, setDay] = useState(defaultDayISO)
  const [time, setTime] = useState('09:00')
  const [minutes, setMinutes] = useState(60)
  const [notes, setNotes] = useState('')

  const clients = useQuery({
    queryKey: queryKeys.clients(user.id),
    queryFn: () => fetchClients(user.id),
    // Nothing to book while the sheet is shut.
    enabled: open,
  })

  const create = useMutation({ mutationKey: mutationKeys.createAppointment })
  const savedOffline = create.isPending && create.isPaused

  const onSubmit = (event) => {
    event.preventDefault()
    const { startsAt, endsAt } = slotToISO(day, time, Number(minutes))

    create.mutate(
      {
        // Generated here, not by the database: this write can pause offline and
        // replay on reconnect, and the id is what makes the replay a no-op
        // instead of a second booking.
        id: crypto.randomUUID(),
        memberId,
        proId: user.id,
        kind,
        startsAt,
        endsAt,
        notes,
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-labelledby': 'new-appointment-title',
          sx: { borderTopLeftRadius: 24, borderTopRightRadius: 24, p: 2 },
        },
      }}
    >
      <Stack component="form" spacing={2} onSubmit={onSubmit}>
        <Typography id="new-appointment-title" variant="h2">
          New appointment
        </Typography>

        {clients.isPending ? <LoadingState /> : null}
        {clients.isError && clients.data === undefined ? (
          <ErrorState error={clients.error} onRetry={clients.refetch} />
        ) : null}

        {clients.data ? (
          <TextField
            select
            label="Client"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            required
            fullWidth
          >
            {clients.data.map((client) => (
              <MenuItem key={client.id} value={client.id}>
                {client.full_name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

        <TextField
          select
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          fullWidth
        >
          {KINDS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction="row" spacing={1}>
          {/* Native date and time inputs: the platform already ships a correct,
              accessible, locale-aware picker on every device this runs on. */}
          <TextField
            label="Date"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            required
            sx={{ flexGrow: 1 }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Start"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
            sx={{ width: 130 }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>

        <TextField
          select
          label="Duration"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          fullWidth
        >
          {DURATIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {option} minutes
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          multiline
          minRows={2}
          fullWidth
        />

        {savedOffline ? (
          <Alert severity="info">
            You are offline. This booking is saved on your device and will sync when you reconnect.
          </Alert>
        ) : null}
        {create.isError ? (
          <Alert severity="error">
            {create.error?.message ?? 'The appointment could not be booked.'}
          </Alert>
        ) : null}

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={!memberId || create.isPending}
        >
          {savedOffline ? 'Saved offline' : create.isPending ? 'Booking…' : 'Book appointment'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </Stack>
    </Drawer>
  )
}
```

- [ ] **Step 4: Write the detail screen**

Create `src/features/calendar/AppointmentDetailScreen.jsx`:

```jsx
import { Alert, Avatar, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchAppointment } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { formatTimeRange } from '../../lib/format.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

const KIND_LABEL = {
  training: 'Personal Training',
  protocol: 'Protocol Consultation',
  nutrition: 'Nutrition Consultation',
}

const STATUS_LABEL = {
  pending: 'Not confirmed yet',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  done: 'Completed',
}

export default function AppointmentDetailScreen() {
  const { appointmentId } = useParams()

  const appointment = useQuery({
    queryKey: queryKeys.appointment(appointmentId),
    queryFn: () => fetchAppointment(appointmentId),
  })

  const setStatus = useMutation({ mutationKey: mutationKeys.setAppointmentStatus })

  if (appointment.isPending) return <LoadingState />
  if (appointment.isError && appointment.data === undefined) {
    return <ErrorState error={appointment.error} onRetry={appointment.refetch} />
  }

  const row = appointment.data
  const move = (status) => setStatus.mutate({ appointmentId, status })
  const savedOffline = setStatus.isPending && setStatus.isPaused

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Typography variant="h1">{KIND_LABEL[row.kind] ?? 'Appointment'}</Typography>
        <Typography color="text.secondary">
          {new Date(row.starts_at).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })}
          {' • '}
          {formatTimeRange(row.starts_at, row.ends_at)}
        </Typography>
        <Stack direction="row">
          <Chip
            size="small"
            label={STATUS_LABEL[row.status] ?? row.status}
            color={row.status === 'cancelled' ? 'error' : row.status === 'done' ? 'success' : 'default'}
          />
        </Stack>
      </Stack>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar src={row.member?.avatar_url ?? undefined} sx={{ width: 48, height: 48 }}>
              {row.member?.full_name?.[0] ?? '?'}
            </Avatar>
            <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h3" noWrap>
                {row.member?.full_name ?? 'Unknown client'}
              </Typography>
              {row.member ? (
                <Typography
                  variant="body2"
                  color="primary"
                  component={Link}
                  to={`/p/clients/${row.member.id}`}
                >
                  Open client profile
                </Typography>
              ) : null}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {row.notes ? (
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 1 }}>
              Notes
            </Typography>
            <Typography>{row.notes}</Typography>
          </CardContent>
        </Card>
      ) : null}

      {savedOffline ? (
        <Alert severity="info">
          You are offline. This change is saved on your device and will sync when you reconnect.
        </Alert>
      ) : null}
      {setStatus.isError ? (
        <Alert severity="error">
          {setStatus.error?.message ?? 'The appointment could not be updated.'}
        </Alert>
      ) : null}

      <Stack spacing={1}>
        {/* Only offer the moves that make sense from here.  A cancelled
            appointment marked "done" is a contradiction the enum permits and
            the UI should not. */}
        {row.status === 'pending' ? (
          <Button variant="contained" disabled={setStatus.isPending} onClick={() => move('confirmed')}>
            Confirm
          </Button>
        ) : null}

        {row.status === 'confirmed' ? (
          <Button variant="contained" disabled={setStatus.isPending} onClick={() => move('done')}>
            Mark as completed
          </Button>
        ) : null}

        {row.status === 'pending' || row.status === 'confirmed' ? (
          <Button color="error" disabled={setStatus.isPending} onClick={() => move('cancelled')}>
            Cancel appointment
          </Button>
        ) : null}

        {row.status === 'cancelled' ? (
          <Button disabled={setStatus.isPending} onClick={() => move('confirmed')}>
            Reinstate
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 5: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'calendar/:appointmentId', ...screen('Appointment Detail') }`:

```jsx
      {
        path: 'calendar/:appointmentId',
        lazy: async () => ({
          Component: (await import('../features/calendar/AppointmentDetailScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 6: Verify**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds.

In the browser as Coach Andrea:
1. `/p/calendar`, tap `+`. The sheet opens with the selected day pre-filled. Book a 60-minute training with a client; the sheet closes and the appointment appears in that day's list and on the agenda if it is today.
2. Tap the new card. Confirm the detail screen shows the client, the day and the time range, and that "Confirm"/"Mark as completed"/"Cancel" appear only for the statuses that allow them.
3. Cancel it, then reinstate it. The chip and the buttons follow.
4. From `/p`, tap `+`: it lands on the calendar with the sheet open.
5. **Offline**: switch DevTools to offline, book an appointment. The button reads "Saved offline". Go back online — it appears without a reload.

- [ ] **Step 7: Commit**

```bash
git add src/data/appointments.js src/data/mutations.js src/lib/mutationKeys.js src/features/calendar src/routes/index.jsx
git commit -m "feat(pro): add appointment detail and booking sheet"
```

---

## Task 12: Weekly availability

**Files:**
- Create: `src/data/availability.js`
- Create: `src/features/calendar/AvailabilityScreen.jsx`
- Modify: `src/lib/mutationKeys.js` (add two keys)
- Modify: `src/data/mutations.js` (register both)
- Modify: `src/routes/index.jsx` (replace the `/p/calendar/availability` placeholder)

**Interfaces:**
- Consumes: `queryKeys.availability`, `queryPrefixes.availability`.
- Produces:
  - `fetchAvailability(proId) -> Array<{id, weekday, starts_at, ends_at}>`
  - `addAvailability({id, proId, weekday, startsAt, endsAt}) -> row`
  - `deleteAvailability({availabilityId}) -> void`
  - the `/p/calendar/availability` screen.

`availability` stores recurring weekly slots as local wall-clock `time` values with `weekday` 0–6. Postgres' `extract(dow)` puts Sunday at 0, and `schema.sql` says only "0 and 6", so this screen uses the same 0 = Sunday convention the database implies — and labels every row by name so the number is never shown.

- [ ] **Step 1: Write the data module**

Create `src/data/availability.js`:

```js
import { supabase } from '../lib/supabase.js'

/**
 * The professional's recurring weekly slots.
 *
 * Ordered by weekday then start time so the screen can group without sorting.
 * `weekday` follows Postgres' convention: 0 is Sunday.
 */
export async function fetchAvailability(proId) {
  const { data, error } = await supabase
    .from('availability')
    .select('id, weekday, starts_at, ends_at')
    .eq('pro_id', proId)
    .order('weekday')
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Add one slot.
 *
 * The caller supplies `id` for the same reason `logSet` does: this write can
 * pause offline and be replayed, and upserting on the client's id turns the
 * replay into a no-op instead of a duplicate slot.
 *
 * The database enforces `ends_at > starts_at` and `weekday between 0 and 6`, so
 * a malformed slot is rejected there rather than trusted from the client.
 */
export async function addAvailability({ id, proId, weekday, startsAt, endsAt }) {
  const { data, error } = await supabase
    .from('availability')
    .upsert(
      { id, pro_id: proId, weekday, starts_at: startsAt, ends_at: endsAt },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  return data
}

/** Remove one slot.  Idempotent: deleting a row that is already gone is a no-op. */
export async function deleteAvailability({ availabilityId }) {
  const { error } = await supabase.from('availability').delete().eq('id', availabilityId)
  if (error) throw error
}
```

- [ ] **Step 2: Register both mutations**

Modify `src/lib/mutationKeys.js`:

```js
  addAvailability: ['addAvailability'],
  deleteAvailability: ['deleteAvailability'],
```

Modify `src/data/mutations.js`:

```js
import { addAvailability, deleteAvailability } from './availability.js'
```

```js
  queryClient.setMutationDefaults(mutationKeys.addAvailability, {
    mutationFn: addAvailability,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.availability })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteAvailability, {
    mutationFn: deleteAvailability,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.availability })
    },
  })
```

- [ ] **Step 3: Write the screen**

Create `src/features/calendar/AvailabilityScreen.jsx`:

```jsx
import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMutation, useQuery } from '@tanstack/react-query'
import { addAvailability, deleteAvailability, fetchAvailability } from '../../data/availability.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

// Index is the stored `weekday`; Postgres puts Sunday at 0, and the column's
// own `between 0 and 6` check follows that.  Displayed Monday-first below, so
// the ordering matches the calendar without changing what is stored.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** `'09:00:00'` → `'09:00'`.  Postgres returns `time` with seconds. */
const hhmm = (value) => String(value).slice(0, 5)

export default function AvailabilityScreen() {
  const { user } = useAuth()

  const [weekday, setWeekday] = useState(1)
  const [startsAt, setStartsAt] = useState('09:00')
  const [endsAt, setEndsAt] = useState('13:00')

  const slots = useQuery({
    queryKey: queryKeys.availability(user.id),
    queryFn: () => fetchAvailability(user.id),
  })

  const add = useMutation({ mutationKey: mutationKeys.addAvailability })
  const remove = useMutation({ mutationKey: mutationKeys.deleteAvailability })

  const savedOffline = add.isPending && add.isPaused
  // The database rejects this too, but telling the user before the round trip
  // is better than an error message from Postgres.
  const invalidRange = endsAt <= startsAt

  if (slots.isPending) return <LoadingState />
  if (slots.isError && slots.data === undefined) {
    return <ErrorState error={slots.error} onRetry={slots.refetch} />
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">Availability</Typography>
        <Typography color="text.secondary">
          The hours you are bookable each week. Members see these when they request a session.
        </Typography>
      </Stack>

      {slots.data.length === 0 ? (
        <EmptyState
          title="No hours set"
          description="Add your first weekly slot below. Until then nobody can request a session."
        />
      ) : null}

      <Stack spacing={2}>
        {DISPLAY_ORDER.map((dayIndex) => {
          const daySlots = slots.data.filter((slot) => slot.weekday === dayIndex)
          if (daySlots.length === 0) return null

          return (
            <Card key={dayIndex}>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1 }}>
                  {DAY_NAMES[dayIndex]}
                </Typography>

                <Stack spacing={1}>
                  {daySlots.map((slot) => (
                    <Stack key={slot.id} direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ flexGrow: 1 }}>
                        {hhmm(slot.starts_at)} – {hhmm(slot.ends_at)}
                      </Typography>
                      <IconButton
                        aria-label={`Remove ${DAY_NAMES[dayIndex]} ${hhmm(slot.starts_at)} to ${hhmm(slot.ends_at)}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ availabilityId: slot.id })}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )
        })}
      </Stack>

      {remove.isError ? (
        <Alert severity="error">{remove.error?.message ?? 'The slot could not be removed.'}</Alert>
      ) : null}

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Add a slot
        </Typography>

        <Card>
          <CardContent>
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault()
                add.mutate(
                  {
                    id: crypto.randomUUID(),
                    proId: user.id,
                    weekday: Number(weekday),
                    startsAt,
                    endsAt,
                  },
                  { onSuccess: () => setWeekday(Number(weekday)) },
                )
              }}
            >
              <TextField
                select
                label="Day"
                value={weekday}
                onChange={(event) => setWeekday(Number(event.target.value))}
                fullWidth
              >
                {DISPLAY_ORDER.map((dayIndex) => (
                  <MenuItem key={dayIndex} value={dayIndex}>
                    {DAY_NAMES[dayIndex]}
                  </MenuItem>
                ))}
              </TextField>

              <Stack direction="row" spacing={1}>
                <TextField
                  label="From"
                  type="time"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                  sx={{ flexGrow: 1 }}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="To"
                  type="time"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  required
                  error={invalidRange}
                  helperText={invalidRange ? 'Must be after the start time' : ' '}
                  sx={{ flexGrow: 1 }}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>

              {savedOffline ? (
                <Alert severity="info">
                  You are offline. This slot is saved on your device and will sync when you
                  reconnect.
                </Alert>
              ) : null}
              {add.isError ? (
                <Alert severity="error">
                  {add.error?.message ?? 'The slot could not be added.'}
                </Alert>
              ) : null}

              <Button
                type="submit"
                variant="contained"
                startIcon={<AddIcon />}
                disabled={invalidRange || add.isPending}
                fullWidth
              >
                {savedOffline ? 'Saved offline' : add.isPending ? 'Adding…' : 'Add slot'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  )
}
```

- [ ] **Step 4: Wire the route**

Modify `src/routes/index.jsx`, replacing `{ path: 'calendar/availability', ...screen('Availability') }`:

```jsx
      {
        path: 'calendar/availability',
        lazy: async () => ({
          Component: (await import('../features/calendar/AvailabilityScreen.jsx')).default,
        }),
      },
```

React Router ranks branches by segment specificity, so the literal `availability` already outranks `:appointmentId` regardless of declaration order — but keep it listed first for readability, as the existing comment in that file says.

- [ ] **Step 5: Verify**

Run: `npm run lint`
Expected: exit 0.

Run: `npm run build`
Expected: build succeeds.

In the browser as Coach Andrea, open `/p/calendar/availability`. Expect the ten seeded slots grouped Monday to Friday, two per day. Add a Saturday slot; it appears under a new Saturday card at the end. Set "To" earlier than "From": the field shows an error and the button is disabled. Remove a slot; the card disappears when its last slot goes.

- [ ] **Step 6: Commit**

```bash
git add src/data/availability.js src/data/mutations.js src/lib/mutationKeys.js src/features/calendar/AvailabilityScreen.jsx src/routes/index.jsx
git commit -m "feat(pro): add weekly availability editor"
```

---

## Phase 3 Acceptance

Run after Task 12, before the final whole-branch review.

- [ ] `npm run lint` exits 0.
- [ ] `npm run build` succeeds.
- [ ] All six self-checks pass: `node src/lib/format.selfcheck.js`, `node src/theme/resolveTokens.selfcheck.js`, `node src/features/workout/{timer,status,summary}.selfcheck.js`, `node src/features/clients/subscription.selfcheck.js`, `node src/features/calendar/month.selfcheck.js`, `node src/features/progress/progress.selfcheck.js`.
- [ ] `supabase/verify.sql` reads PASS on every row, with the three table counts at 16.
- [ ] Signed in as Coach Andrea, every route in the professional tree renders real content except `/p/chat`, `/p/chat/:threadId`, `/p/scan`, `/p/profile`, `/p/profile/settings`, which are still Phase 4 placeholders. No dead links, no blank regions.
- [ ] Signed in as Daniel, the member tree is unchanged: Home still names Coach Andrea on each appointment card, and `/m/workout/builder` still saves a session.
- [ ] A change made by the professional is visible to the member: add a session to Daniel's plan, then open `/m/workout` as Daniel and see it.
- [ ] **Offline round trip:** with DevTools offline, book an appointment, record a check-in and add an availability slot. Each control reads "Saved offline". Go back online; all three land in Postgres without a reload.
- [ ] **Offline cold start:** load `/p`, `/p/clients` and `/p/calendar` online, then go offline and hard-reload each. The persisted cache serves them; no screen shows an error over data it already holds.

## Deferred to later phases

- `/p/chat` and `/p/chat/:threadId` — Phase 4 owns realtime chat. The client dossier's Chat control already links to `/p/chat`.
- `/p/scan` — Phase 4 owns the QR scanner and the `checkins` write.
- `/p/profile` and `/p/profile/settings` — Phase 4 owns both profile screens, **including the logout control**, per the decision recorded after Phase 1.
- The member's `/m/nutrition` and `/m/nutrition/meal/:mealId` read what Task 8 writes; Phase 4 builds them.
- Availability is not yet enforced when booking: the sheet lets a professional book any slot, including outside their own hours. Members booking through `/m/trainer` in Phase 4 is where the constraint has to bite.
- Session reordering. Deletion closes the orphan-session hole; drag-to-reorder is not built and no wireframe asks for it.
