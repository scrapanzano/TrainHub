# Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bell's hardcoded chat shortcut with a real notification center: a persisted `notifications` table backing a list screen, each row linking to the page that generated it, clearing when read either from the list or by visiting its target directly.

**Architecture:** `notify_user()` (already the single choke point every server-raised notification passes through) gains a `p_type` argument and now inserts a `notifications` row before it fires its existing Web Push — one write path, no duplicated logic across the four trigger functions. Two new `security definer` RPCs let the signed-in caller mark their own rows read, by id (tapping a row) or by url (visiting the page). A single shared screen (mirroring how `ProfileScreen`/`SettingsScreen` already serve both roles from one file) renders the list at both `/m/notifications` and `/p/notifications`.

**Tech Stack:** React 19 + Vite 8, plain JS/JSX, MUI v9, React Router 8 (lazy per-screen), TanStack Query v5, Supabase (Postgres, RLS, RPC-only writes, `pg_net` push already wired), hand-applied SQL patches.

## Global Constraints

- No TypeScript. Plain JS/JSX, ESM. All styling through the MUI theme.
- `npm run lint` AND `npm run build` must both pass on every code task.
- No `eslint-disable`, ever. If lint objects, the code is wrong.
- No test runner is configured. This plan's code changes have no pure logic
  worth a `*.selfcheck.js` (routing, RPC calls, mount effects) — verification
  is lint/build plus, for the SQL task, Davide applying the patch by hand and
  reading its PASS/FAIL block.
- Every write is registered in `src/data/mutations.js` via
  `setMutationDefaults`. A call site must never pass `onSettled` to
  `useMutation` (it replaces the registered handler).
- `RLS is the security boundary, and it is not the first gate` — Postgres
  checks the table `GRANT` before any policy (CLAUDE.md), so a new table's
  `grant select ... to authenticated` is not optional decoration.
- **Whitespace-stripped `LIKE` self-checks:** when a check does
  `regexp_replace(lower(pg_get_functiondef(...)), '[[:space:]]+', '', 'g')`,
  the comparison pattern must ALSO have no spaces in it (`patches/017`
  shipped this bug once already).
- **Changing a `security definer` function's parameter list changes its
  overload identity.** `create or replace function` only replaces a function
  with the SAME parameter types; adding an argument creates a second,
  parallel overload unless the old one is dropped first (`patches/018`'s
  fix, repeated here for `notify_user()`).
- `supabase/` patches are applied by hand by Davide in the Supabase SQL
  editor — no agent has DB credentials. Every patch ends with a
  `select ... case when actual is not distinct from expected then 'PASS'
  else 'FAIL' end status` block, and is idempotent.
- Commits: Conventional Commits, Davide as sole author, **no `Co-Authored-By`
  trailer**. Stage only the files each task names.

---

### Task 1: SQL patch 020 — the `notifications` table, `notify_user()` extended, two mark-read RPCs

**Files:**
- Create: `supabase/patches/020-notifications.sql`

**Interfaces:**
- Consumes: `public.app_config`, `net.http_post` (unchanged, `patches/010`).
- Produces: table `public.notifications (id, user_id, type, title, body, url,
  read_at, created_at)`. `public.notify_user(p_user uuid, p_title text,
  p_body text, p_url text, p_type text) returns void` — signature grows by
  one argument; the four existing triggers (`notify_on_message`,
  `notify_on_appointment_status`, `notify_on_workout_plan`,
  `notify_on_nutrition_plan`) are updated to pass it, using `'message'`,
  `'appointment'`, `'workout_plan'`, `'nutrition_plan'` respectively — Task 2
  and Task 4's code reference these exact string values. `public.
  mark_notification_read_secure(p_id uuid) returns void` and `public.
  mark_notifications_read_secure(p_url text) returns void`, both callable by
  `authenticated`.

- [ ] **Step 1: Write the patch file**

```sql
-- Patch 020 -- a real notification center.
--
-- notify_user() (patches/010) only ever fired an external Web Push; nothing
-- was ever persisted, so there was nothing to list, mark read, or reconcile
-- against a tapped OS notification. This patch adds that persistence: every
-- call to notify_user() now also writes a row here, and two new RPCs let the
-- signed-in caller mark their own rows read -- one at a time (tapping a row
-- in the list) or by URL (visiting the page a notification points at,
-- however they got there).
--
-- notify_user()'s signature grows by one argument (p_type), which is a
-- DIFFERENT overload as far as Postgres is concerned -- the old 4-argument
-- version is dropped explicitly first, same lesson patch 018 already
-- documented, or it would linger alongside the new one.
--
-- Idempotent: safe to replay.

begin;

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  url        text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on public.notifications (user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

-- Postgres checks the table GRANT before it evaluates any policy -- the
-- grant is the gate that actually runs first (patches/006).
grant select on public.notifications to authenticated;
revoke insert, update, delete on public.notifications from authenticated, anon;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (user_id = auth.uid());

drop function if exists public.notify_user(uuid, text, text, text);

create or replace function public.notify_user(
  p_user  uuid,
  p_title text,
  p_body  text,
  p_url   text,
  p_type  text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  insert into public.notifications (user_id, type, title, body, url)
  values (p_user, p_type, p_title, p_body, p_url);

  select value into v_url    from public.app_config where key = 'notify_function_url';
  select value into v_secret from public.app_config where key = 'notify_secret';

  -- Unconfigured is not an error: the badge and the scanner must keep working
  -- on a database where the Edge Function was never deployed.
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-notify-secret', v_secret),
    body    := jsonb_build_object(
                 'user_id', p_user,
                 'title',   p_title,
                 'body',    p_body,
                 'url',     p_url)
  );
exception when others then
  raise warning 'notify_user failed for %: %', p_user, sqlerrm;
end $$;

revoke execute on function public.notify_user(uuid,text,text,text,text)
  from public, anon, authenticated;

-- 1. A new chat message notifies the OTHER party.
create or replace function notify_on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_target uuid;
  v_sender text;
begin
  select case when t.member_id = new.sender_id then t.pro_id else t.member_id end
  into v_target
  from public.threads t where t.id = new.thread_id;

  select full_name into v_sender from public.profiles where id = new.sender_id;

  perform public.notify_user(
    v_target,
    coalesce(v_sender, 'New message'),
    left(new.body, 120),
    case when v_target = (select member_id from public.threads where id = new.thread_id)
         then '/m/trainer/chat'
         else '/p/chat/' || new.thread_id::text
    end,
    'message');
  return null;
exception when others then
  raise warning 'notify_on_message failed: %', sqlerrm;
  return null;
end $$;

-- 2. An appointment reaching 'confirmed', 'cancelled' or 'done' notifies the member.
create or replace function notify_on_appointment_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;

  -- 'pending' is not news to anyone yet -- only a row that reaches
  -- 'confirmed', 'cancelled' or 'done' is.
  if new.status = 'pending' then
    return null;
  end if;

  perform public.notify_user(
    new.member_id,
    'Appointment ' || new.status,
    to_char(new.starts_at, 'Dy DD Mon at HH24:MI'),
    '/m/trainer/appointments',
    'appointment');
  return null;
exception when others then
  raise warning 'notify_on_appointment_status failed: %', sqlerrm;
  return null;
end $$;

-- 3 and 4. A newly assigned plan notifies the member. Two tables, one event,
-- and the copy names which kind arrived.
create or replace function notify_on_workout_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_user(new.member_id, 'New workout plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/workout',
                      'workout_plan');
  return null;
exception when others then
  raise warning 'notify_on_workout_plan failed: %', sqlerrm;
  return null;
end $$;

create or replace function notify_on_nutrition_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_user(new.member_id, 'New nutrition plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/nutrition',
                      'nutrition_plan');
  return null;
exception when others then
  raise warning 'notify_on_nutrition_plan failed: %', sqlerrm;
  return null;
end $$;

-- The four triggers already exist (patches/010) and already point at these
-- function names -- redefining the functions is enough, no trigger DDL to
-- replay here.

create or replace function public.mark_notification_read_secure(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where id = p_id and user_id = auth.uid() and read_at is null;
end $$;

revoke execute on function public.mark_notification_read_secure(uuid)
  from public, anon;
grant execute on function public.mark_notification_read_secure(uuid)
  to authenticated;

create or replace function public.mark_notifications_read_secure(p_url text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and url = p_url and read_at is null;
end $$;

revoke execute on function public.mark_notifications_read_secure(text)
  from public, anon;
grant execute on function public.mark_notifications_read_secure(text)
  to authenticated;

drop table if exists pg_temp.patch_020_checks;
create temporary table patch_020_checks (
  check_name text not null, actual text, expected text not null
) on commit preserve rows;

insert into patch_020_checks (check_name, actual, expected) values
  ('notifications table exists',
   (select (count(*) = 1)::text from information_schema.tables
    where table_schema = 'public' and table_name = 'notifications'),
   'true'),
  ('the app role cannot write notifications directly',
   (not (has_table_privilege('authenticated', 'public.notifications', 'insert')
      or has_table_privilege('authenticated', 'public.notifications', 'update')
      or has_table_privilege('authenticated', 'public.notifications', 'delete')))::text,
   'true'),
  ('the app role can only read its own notifications',
   (select (count(*) = 1)::text from pg_policies
    where schemaname = 'public' and tablename = 'notifications'
      and policyname = 'notifications_select'),
   'true'),
  ('the old notify_user overload is gone',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_user'),
   '1'),
  ('notify_user persists before it pushes',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%insertintopublic.notifications%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_user'),
   'true'),
  ('notify_user stays unreachable from the browser',
   (not has_function_privilege('authenticated',
      'public.notify_user(uuid,text,text,text,text)', 'execute')
    and not has_function_privilege('anon',
      'public.notify_user(uuid,text,text,text,text)', 'execute'))::text,
   'true'),
  ('authenticated caller can mark one notification read',
   has_function_privilege('authenticated',
     'public.mark_notification_read_secure(uuid)', 'execute')::text,
   'true'),
  ('authenticated caller can mark notifications read by url',
   has_function_privilege('authenticated',
     'public.mark_notifications_read_secure(text)', 'execute')::text,
   'true'),
  ('anonymous caller cannot mark anything read',
   (not has_function_privilege('anon',
      'public.mark_notification_read_secure(uuid)', 'execute')
    and not has_function_privilege('anon',
      'public.mark_notifications_read_secure(text)', 'execute'))::text,
   'true');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_020_checks
order by check_name;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/patches/020-notifications.sql
git commit -m "feat(db): persist notifications and let a caller mark their own read"
```

- [ ] **Step 3: Hand off to Davide**

This patch cannot be applied by an agent (no DB credentials). Ask Davide to
run it in the Supabase SQL editor after `019` and confirm every row in the
final `select` reads `PASS`. Later tasks' code changes build and lint fine
regardless, but manual testing of Task 3's screen needs this applied first.

---

### Task 2: `src/data/notifications.js`, query/mutation keys, and their registration

**Files:**
- Create: `src/data/notifications.js`
- Modify: `src/lib/queryKeys.js`
- Modify: `src/lib/mutationKeys.js`
- Modify: `src/data/mutations.js`

**Interfaces:**
- Consumes: `supabase` client (`src/lib/supabase.js`, unchanged).
- Produces: `fetchNotifications(userId)`, `fetchUnreadNotificationCount
  (userId)`, `markNotificationRead({ id })`, `markNotificationsRead({ url })`
  — all in `src/data/notifications.js`. `queryKeys.notifications(userId)`,
  `queryKeys.unreadNotificationCount(userId)`, `queryPrefixes.notifications`.
  `mutationKeys.markNotificationRead`, `mutationKeys.markNotificationsRead`.
  Task 3, 4 and 5 all consume these exact names.

- [ ] **Step 1: Create `src/data/notifications.js`**

```js
import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which is
// the wrong call offline. Retry only when the browser thinks there is a
// network. Applied to every read below.

const NOTIFICATION_COLUMNS = 'id, type, title, body, url, read_at, created_at'

/** Every notification for this user, newest first. */
export async function fetchNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/** How many of this user's notifications are unread, for the bell's badge. */
export async function fetchUnreadNotificationCount(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
    .retry(navigator.onLine)

  if (error) throw error
  return count ?? 0
}

/** Mark one notification read -- tapping it in the list. */
export async function markNotificationRead({ id }) {
  const { error } = await supabase.rpc('mark_notification_read_secure', { p_id: id })
  if (error) throw error
}

/**
 * Mark every one of this user's unread notifications for one URL read --
 * called when the page a notification points at is actually visited,
 * however the visitor got there. The RPC only touches rows still unread, so
 * calling it again for a page with nothing new is a harmless no-op.
 */
export async function markNotificationsRead({ url }) {
  const { error } = await supabase.rpc('mark_notifications_read_secure', { p_url: url })
  if (error) throw error
}
```

- [ ] **Step 2: Add the two query keys and the prefix to `src/lib/queryKeys.js`**

Add these two lines inside the `queryKeys` object (anywhere among the other
entries — after `professionals: () => ['professionals'],` is fine):

```js
  notifications: (userId) => ['notifications', 'list', userId],
  unreadNotificationCount: (userId) => ['notifications', 'unread', userId],
```

Add this line inside the `queryPrefixes` object:

```js
  notifications: ['notifications'],
```

- [ ] **Step 3: Add the two mutation keys to `src/lib/mutationKeys.js`**

Add these two lines inside the `mutationKeys` object (after
`chooseProfessional: ['chooseProfessional'],` is fine):

```js
  markNotificationRead: ['markNotificationRead'],
  markNotificationsRead: ['markNotificationsRead'],
```

- [ ] **Step 4: Register both mutations in `src/data/mutations.js`**

Add `markNotificationRead, markNotificationsRead` to the import from
`./notifications.js` (new import line, since nothing from that file is
imported yet):

```js
import { markNotificationRead, markNotificationsRead } from './notifications.js'
```

Add these two registrations (anywhere among the other
`queryClient.setMutationDefaults(...)` calls, e.g. right after the
`chooseProfessional` block near the end of `registerMutationDefaults`):

```js
  queryClient.setMutationDefaults(mutationKeys.markNotificationRead, {
    mutationFn: markNotificationRead,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markNotificationsRead, {
    mutationFn: markNotificationsRead,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (nothing calls these yet — Task 3 and 4 are the
first callers — so this only proves the new file and registrations are
syntactically sound and correctly wired).

- [ ] **Step 6: Commit**

```bash
git add src/data/notifications.js src/lib/queryKeys.js src/lib/mutationKeys.js src/data/mutations.js
git commit -m "feat: data layer and mutation registrations for notifications"
```

---

### Task 3: `NotificationsScreen.jsx` and its two routes

**Files:**
- Create: `src/features/notifications/NotificationsScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:**
- Consumes: `fetchNotifications`, `queryKeys.notifications`,
  `mutationKeys.markNotificationRead` (Task 2).
- Produces: the screen mounted at `/m/notifications` and `/p/notifications`.
  Task 5 links the bell to these routes.

- [ ] **Step 1: Create `src/features/notifications/NotificationsScreen.jsx`**

```jsx
import { Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchNotifications } from '../../data/notifications.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

const TYPE_LABELS = {
  message: 'Message',
  appointment: 'Appointment',
  workout_plan: 'Workout plan',
  nutrition_plan: 'Nutrition plan',
}

/**
 * Every notification for the signed-in user, newest first. Shared by both
 * roles -- RLS already scopes the underlying table to the caller, and the
 * rendering (title, body, type, tap-to-open) is identical either way,
 * exactly like `ProfileScreen.jsx`/`SettingsScreen.jsx` already are.
 *
 * Opening this screen does not mark anything read on its own: a notification
 * clears only once its own target is actually visited, whether that visit
 * started here or somewhere else entirely.
 */
export default function NotificationsScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const notifications = useQuery({
    queryKey: queryKeys.notifications(user.id),
    queryFn: () => fetchNotifications(user.id),
  })

  const markRead = useMutation({ mutationKey: mutationKeys.markNotificationRead })

  if (notifications.isPending) return <LoadingState />
  // `data === undefined` means it never loaded. A refetch can fail while the
  // persisted cache still holds a good list; an error screen over usable
  // data would be the wrong answer for an offline gym.
  if (notifications.isError && notifications.data === undefined) {
    return <ErrorState error={notifications.error} onRetry={notifications.refetch} />
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h1">Notifications</Typography>

      {notifications.data.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="New messages, appointments and plans show up here."
        />
      ) : null}

      <Stack spacing={2}>
        {notifications.data.map((item) => (
          <Card key={item.id}>
            <CardActionArea
              onClick={() => {
                if (!item.read_at) markRead.mutate({ id: item.id })
                navigate(item.url)
              }}
            >
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography
                      variant="h3"
                      noWrap
                      sx={{ fontWeight: item.read_at ? 400 : 700 }}
                    >
                      {item.title}
                    </Typography>
                    {item.body ? (
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {item.body}
                      </Typography>
                    ) : null}
                    <Typography variant="body2" color="text.secondary">
                      {TYPE_LABELS[item.type] ?? item.type} ·{' '}
                      {new Date(item.created_at).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Typography>
                  </Stack>
                  {item.read_at ? null : (
                    <Stack
                      sx={{
                        width: 8, height: 8, borderRadius: '50%',
                        bgcolor: 'primary.main', mt: 0.75, flexShrink: 0,
                      }}
                    />
                  )}
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 2: Add both routes in `src/routes/index.jsx`**

In the `/m` route's `children` array, add this entry (placed after the
`profile/settings` entry, the last one in that array):

```jsx
      {
        path: 'notifications',
        lazy: async () => ({
          Component: (await import('../features/notifications/NotificationsScreen.jsx')).default,
        }),
      },
```

In the `/p` route's `children` array, add this entry (placed after the
`profile/settings` entry, the last one in that array):

```jsx
      {
        path: 'notifications',
        lazy: async () => ({
          Component: (await import('../features/notifications/NotificationsScreen.jsx')).default,
        }),
      },
```

(Both entries `import()` the exact same file path — this is the shared
screen, mounted twice.)

- [ ] **Step 3: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/features/notifications/NotificationsScreen.jsx src/routes/index.jsx
git commit -m "feat: notification list screen, shared by both roles"
```

---

### Task 4: Mark notifications read on visiting their target — four screens

**Files:**
- Modify: `src/features/chat/ThreadScreen.jsx`
- Modify: `src/features/trainer/MemberAppointmentsScreen.jsx`
- Modify: `src/features/workout/WorkoutPlanScreen.jsx`
- Modify: `src/features/nutrition/MemberNutritionScreen.jsx`

**Interfaces:**
- Consumes: `mutationKeys.markNotificationsRead` (Task 2).

- [ ] **Step 1: `ThreadScreen.jsx`**

This file already imports `useEffect`, `useRef`, `useMutation` and
`mutationKeys` — no new imports needed. Add this block right after the
existing `markedUpTo`/`useEffect` pair that calls `markRead.mutate(...)`
(i.e. immediately after that effect's closing `}, [...])`):

```jsx
  // A chat notification's url is role-specific (patches/020): the member's
  // is the static thread route, the professional's names the thread. Fires
  // once per thread, independent of the message-read-receipt effect above --
  // that one is about individual messages, this one is about the
  // notifications-center row this thread's messages generated.
  const notifiedFor = useRef(null)
  const markNotificationsRead = useMutation({ mutationKey: mutationKeys.markNotificationsRead })
  useEffect(() => {
    if (!threadId || notifiedFor.current === threadId) return
    notifiedFor.current = threadId
    markNotificationsRead.mutate({
      url: isMember ? '/m/trainer/chat' : `/p/chat/${threadId}`,
    })
  }, [threadId, isMember, markNotificationsRead])
```

- [ ] **Step 2: `MemberAppointmentsScreen.jsx`**

Change the top of the file. The current import lines are:

```js
import { useState } from 'react'
import { Box, Card, CardActionArea, CardContent, IconButton, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
```

Change them to:

```js
import { useEffect, useRef, useState } from 'react'
import { Box, Card, CardActionArea, CardContent, IconButton, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useMutation, useQuery } from '@tanstack/react-query'
```

Add this import alongside the other `../../lib/...` imports (e.g. right
after `import { queryKeys } from '../../lib/queryKeys.js'`):

```js
import { mutationKeys } from '../../lib/mutationKeys.js'
```

Inside the component function, right after the existing
`const appointments = useQuery({...})` block, add:

```jsx
  // Fires once per mount, independent of how this screen was reached --
  // clears the "Appointment confirmed/cancelled/done" notification the same
  // way visiting it always would, bell or not (patches/020).
  const notified = useRef(false)
  const markNotificationsRead = useMutation({ mutationKey: mutationKeys.markNotificationsRead })
  useEffect(() => {
    if (notified.current) return
    notified.current = true
    markNotificationsRead.mutate({ url: '/m/trainer/appointments' })
  }, [markNotificationsRead])
```

- [ ] **Step 3: `WorkoutPlanScreen.jsx`**

Change the top of the file. The current import lines are:

```js
import {
  Box, Button, Card, CardContent, Divider, LinearProgress, Stack, Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
```

Change them to:

```js
import { useEffect, useRef } from 'react'
import {
  Box, Button, Card, CardContent, Divider, LinearProgress, Stack, Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
```

Inside `export default function WorkoutPlanScreen()`, right after the
existing `const { data, isPending, isError, error, refetch } = useQuery({...})`
block, add:

```jsx
  // Fires once per mount, independent of how this screen was reached --
  // clears the "New workout plan" notification the same way visiting it
  // always would, bell or not (patches/020).
  const notified = useRef(false)
  const markNotificationsRead = useMutation({ mutationKey: mutationKeys.markNotificationsRead })
  useEffect(() => {
    if (notified.current) return
    notified.current = true
    markNotificationsRead.mutate({ url: '/m/workout' })
  }, [markNotificationsRead])
```

Place this BEFORE the existing `if (isPending) return <LoadingState />` line
— hooks must run unconditionally on every render, so it cannot go after an
early return.

- [ ] **Step 4: `MemberNutritionScreen.jsx`**

Change the top of the file. The current import lines are:

```js
import { useState } from 'react'
import { Box, Button, Card, CardActionArea, CardContent, Divider, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
```

Change them to:

```js
import { useEffect, useRef, useState } from 'react'
import { Box, Button, Card, CardActionArea, CardContent, Divider, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useMutation, useQuery } from '@tanstack/react-query'
```

Add this import alongside the other `../../lib/...` imports (e.g. right
after `import { queryKeys } from '../../lib/queryKeys.js'`):

```js
import { mutationKeys } from '../../lib/mutationKeys.js'
```

Inside the component function, right after the existing `const nutrition =
useQuery({...})` block, add:

```jsx
  // Fires once per mount, independent of how this screen was reached --
  // clears the "New nutrition plan" notification the same way visiting it
  // always would, bell or not (patches/020).
  const notified = useRef(false)
  const markNotificationsRead = useMutation({ mutationKey: mutationKeys.markNotificationsRead })
  useEffect(() => {
    if (notified.current) return
    notified.current = true
    markNotificationsRead.mutate({ url: '/m/nutrition' })
  }, [markNotificationsRead])
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint`
Expected: no errors — this is the real check that every added hook is
called unconditionally (no early return above it) and every new import is
actually used.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/ThreadScreen.jsx src/features/trainer/MemberAppointmentsScreen.jsx src/features/workout/WorkoutPlanScreen.jsx src/features/nutrition/MemberNutritionScreen.jsx
git commit -m "feat: clear a notification when the page it points to is visited"
```

---

### Task 5: Repoint the bell — `AppLayout.jsx` and `TopHeader.jsx`

**Files:**
- Modify: `src/layouts/AppLayout.jsx`
- Modify: `src/components/TopHeader.jsx`

**Interfaces:**
- Consumes: `fetchUnreadNotificationCount`, `queryKeys.unreadNotificationCount`
  (Task 2).

- [ ] **Step 1: `AppLayout.jsx`**

Replace this import line:

```js
import { fetchUnreadCount } from '../data/chat.js'
```

with:

```js
import { fetchUnreadNotificationCount } from '../data/notifications.js'
```

Replace the `unread` query:

```jsx
  const unread = useQuery({
    queryKey: queryKeys.unreadCount(user?.id),
    queryFn: () => fetchUnreadCount(user.id),
    // Nothing to count until somebody is signed in.
    enabled: Boolean(user?.id),
    // Polled rather than pushed: the chat's Realtime channel is filtered to one
    // `thread_id` and lives on the conversation screen, so it cannot feed a
    // badge that must count every thread. This layout never unmounts on inner
    // navigation either, so without an interval the badge freezes at its
    // page-load value. A shell-level subscription is the fuller answer and is
    // not worth a second channel at this scale.
    refetchInterval: 60_000,
  })
```

with:

```jsx
  const unread = useQuery({
    queryKey: queryKeys.unreadNotificationCount(user?.id),
    queryFn: () => fetchUnreadNotificationCount(user.id),
    // Nothing to count until somebody is signed in.
    enabled: Boolean(user?.id),
    // Polled rather than pushed: nothing in this shell subscribes to
    // Realtime for every notification-generating table, so a badge that
    // must reflect messages, appointments and plans together needs a poll
    // to notice a change made elsewhere. Same interval the chat inbox
    // already polls at.
    refetchInterval: 60_000,
  })
```

Replace the `TopHeader` usage:

```jsx
        <TopHeader
          profileHref={profileHref}
          notificationCount={unread.data ?? 0}
          notificationHref={requiredRole === 'professional' ? '/p/chat' : '/m/trainer/chat'}
          scanHref={requiredRole === 'professional' ? '/p/scan' : undefined}
        />
```

with:

```jsx
        <TopHeader
          profileHref={profileHref}
          notificationCount={unread.data ?? 0}
          notificationHref={requiredRole === 'professional' ? '/p/notifications' : '/m/notifications'}
          scanHref={requiredRole === 'professional' ? '/p/scan' : undefined}
        />
```

- [ ] **Step 2: `TopHeader.jsx`**

Replace the `IconButton`'s `aria-label`:

```jsx
        <IconButton
          component={Link}
          to={notificationHref}
          aria-label={
            notificationCount === 0
              ? 'No unread messages'
              : `${notificationCount} unread message${notificationCount === 1 ? '' : 's'}`
          }
        >
```

with:

```jsx
        <IconButton
          component={Link}
          to={notificationHref}
          aria-label={
            notificationCount === 0
              ? 'No unread notifications'
              : `${notificationCount} unread notification${notificationCount === 1 ? '' : 's'}`
          }
        >
```

- [ ] **Step 3: Remove the now-unused `fetchUnreadCount`/`queryKeys.unreadCount`**

After Step 1, `AppLayout.jsx` was the only caller of both —
`ThreadListScreen.jsx` computes its own per-thread unread counts inline from
`fetchThreads`'s result, it never called `fetchUnreadCount` separately.
Confirm this with:

```bash
grep -rn "fetchUnreadCount\|unreadCount(" src --include=*.jsx --include=*.js
```

Expected: only the definitions themselves (`src/data/chat.js`'s
`fetchUnreadCount` export and `src/lib/queryKeys.js`'s `unreadCount` entry),
no remaining call site. If that is not what you see, STOP — something
other than `AppLayout.jsx` depends on one of these, and removing it would
break that caller; report it instead of removing anything.

If confirmed unused, delete the `fetchUnreadCount` function (with its JSDoc
comment) from `src/data/chat.js`, and delete the `unreadCount: (userId) =>
['chat', 'unread', userId],` line from `src/lib/queryKeys.js`.

- [ ] **Step 4: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/AppLayout.jsx src/components/TopHeader.jsx src/data/chat.js src/lib/queryKeys.js
git commit -m "feat: point the bell at the notification list instead of chat"
```

---

### Task 6: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 2: Confirm patch 020 is applied**

Ask Davide to confirm `020` shows a full `PASS` block in the Supabase SQL
editor (Task 1's handoff step).

- [ ] **Step 3: Manual click-through (Davide, in a worktree running `npm run
      dev`)**

1. As `daniel@trainhub.dev` (member): have `andrea@trainhub.dev` send a chat
   message, confirm an appointment, or create a workout/nutrition plan for
   daniel (whichever is easiest to trigger) — then, as daniel, open the bell.
   Confirm the notification appears, unread (bold, with the small dot).
2. Tap it. Confirm it navigates to the right page (chat / appointments /
   workout / nutrition matching what was triggered) and that reopening the
   bell now shows it as read (no dot, normal weight).
3. Trigger a second notification, but this time navigate to its destination
   screen directly (bottom nav, not the bell). Reopen the bell — confirm it
   is marked read even though it was never tapped in the list.
4. Confirm the bell's badge count matches the number of unread rows shown in
   the list, and drops to 0 once everything above is read.
5. As `andrea@trainhub.dev` (professional), confirm `/p/notifications` is
   reachable from the bell and shows a message notification the same way.
