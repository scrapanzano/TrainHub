# Notification Center Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bell's badge update in real time, fix the wrong local time in the appointment push, and let a user manage their notification list (delete, bulk mark-read/delete on a selection, mark-all/delete-all) instead of it only ever growing.

**Architecture:** A Supabase Realtime channel in `AppLayout.jsx`, filtered to the signed-in user, invalidates the notifications query family on `INSERT` — the same "query is truth, Realtime only triggers a refetch" pattern `useThreadMessages.js` already uses for chat. Five new `security definer` RPCs (patch 021, alongside the timezone fix) extend the two from patch 020 with delete and bulk variants. `NotificationsScreen.jsx` gains an All/Unread filter and a selection mode built from a plain `Set` of ids in component state — no gesture library, no new dependency.

**Tech Stack:** React 19 + Vite 8, plain JS/JSX, MUI v9, TanStack Query v5, Supabase (Postgres, RLS, RPC-only writes, Realtime), hand-applied SQL patches.

## Global Constraints

- No TypeScript. Plain JS/JSX, ESM. All styling through the MUI theme.
- `npm run lint` AND `npm run build` must both pass on every code task.
- No `eslint-disable`, ever.
- No test runner is configured. This plan's code changes have no pure logic
  worth a `*.selfcheck.js` — verification is lint/build plus, for the SQL
  task, Davide applying the patch by hand and reading its PASS/FAIL block.
- Every write is registered in `src/data/mutations.js` via
  `setMutationDefaults`. A call site must never pass `onSettled` to
  `useMutation`.
- `supabase/` patches are applied by hand by Davide in the Supabase SQL
  editor — no agent has DB credentials. Every patch ends with a
  `select ... case when actual is not distinct from expected then 'PASS'
  else 'FAIL' end status` block, and is idempotent.
- **Whitespace-stripped `LIKE` self-checks:** when a check does
  `regexp_replace(lower(pg_get_functiondef(...)), '[[:space:]]+', '', 'g')`,
  the comparison pattern must ALSO have no spaces in it, AND the haystack
  is also lower-cased — a string literal inside the checked function body
  (e.g. `'Europe/Rome'`) is lower-cased too, so the pattern must match the
  lower-cased form (`'europe/rome'`), not the original casing.
- No new npm dependency for this plan — selection is a plain `Set` in
  component state, not a gesture/swipe library.
- Commits: Conventional Commits, Davide as sole author, **no `Co-Authored-By`
  trailer**. Stage only the files each task names.

---

### Task 1: SQL patch 021 — timezone fix and five list-management RPCs

**Files:**
- Create: `supabase/patches/021-notification-management.sql`

**Interfaces:**
- Consumes: `public.notifications` (`patches/020`), `public.notify_user`
  (`patches/020`, unchanged here).
- Produces: `public.delete_notification_secure(p_id uuid)`, `public.
  mark_notifications_read_by_ids_secure(p_ids uuid[])`, `public.
  delete_notifications_by_ids_secure(p_ids uuid[])`, `public.
  mark_all_notifications_read_secure()`, `public.
  delete_all_notifications_secure()` — all `security definer`, all
  callable by `authenticated` only. Task 2's `src/data/notifications.js`
  calls these five by exact name.

- [ ] **Step 1: Write the patch file**

```sql
-- Patch 021 -- correct the appointment push's timezone, and let a caller
-- manage their own notification list (delete, bulk actions, clear all).
--
-- notify_on_appointment_status() formatted `starts_at` (timestamptz, stored
-- UTC) in the trigger's default session timezone rather than Europe/Rome,
-- so a 10:12 local appointment read 8:00 in the push -- the exact 2-hour
-- CEST offset. Fixed the same way patches/016 fixed `reward_day`.
--
-- The five new RPCs mirror the two in patches/020 (single-id vs bulk vs
-- everything), each `security definer`, scoped to auth.uid(), no direct
-- table write grant to the browser.
--
-- Idempotent: safe to replay.

begin;

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
    to_char(new.starts_at at time zone 'Europe/Rome', 'Dy DD Mon at HH24:MI'),
    '/m/trainer/appointments',
    'appointment');
  return null;
exception when others then
  raise warning 'notify_on_appointment_status failed: %', sqlerrm;
  return null;
end $$;

create or replace function public.delete_notification_secure(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where id = p_id and user_id = auth.uid();
end $$;

revoke execute on function public.delete_notification_secure(uuid)
  from public, anon;
grant execute on function public.delete_notification_secure(uuid)
  to authenticated;

create or replace function public.mark_notifications_read_by_ids_secure(p_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and id = any(p_ids) and read_at is null;
end $$;

revoke execute on function public.mark_notifications_read_by_ids_secure(uuid[])
  from public, anon;
grant execute on function public.mark_notifications_read_by_ids_secure(uuid[])
  to authenticated;

create or replace function public.delete_notifications_by_ids_secure(p_ids uuid[])
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where user_id = auth.uid() and id = any(p_ids);
end $$;

revoke execute on function public.delete_notifications_by_ids_secure(uuid[])
  from public, anon;
grant execute on function public.delete_notifications_by_ids_secure(uuid[])
  to authenticated;

create or replace function public.mark_all_notifications_read_secure()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
end $$;

revoke execute on function public.mark_all_notifications_read_secure()
  from public, anon;
grant execute on function public.mark_all_notifications_read_secure()
  to authenticated;

create or replace function public.delete_all_notifications_secure()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where user_id = auth.uid();
end $$;

revoke execute on function public.delete_all_notifications_secure()
  from public, anon;
grant execute on function public.delete_all_notifications_secure()
  to authenticated;

drop table if exists pg_temp.patch_021_checks;
create temporary table patch_021_checks (
  check_name text not null, actual text, expected text not null
) on commit preserve rows;

insert into patch_021_checks (check_name, actual, expected) values
  ('appointment push formats in Europe/Rome',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%attimezone''europe/rome''%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'notify_on_appointment_status'),
   'true'),
  ('authenticated caller can delete one notification',
   has_function_privilege('authenticated',
     'public.delete_notification_secure(uuid)', 'execute')::text,
   'true'),
  ('authenticated caller can mark a selection read',
   has_function_privilege('authenticated',
     'public.mark_notifications_read_by_ids_secure(uuid[])', 'execute')::text,
   'true'),
  ('authenticated caller can delete a selection',
   has_function_privilege('authenticated',
     'public.delete_notifications_by_ids_secure(uuid[])', 'execute')::text,
   'true'),
  ('authenticated caller can mark everything read',
   has_function_privilege('authenticated',
     'public.mark_all_notifications_read_secure()', 'execute')::text,
   'true'),
  ('authenticated caller can delete everything',
   has_function_privilege('authenticated',
     'public.delete_all_notifications_secure()', 'execute')::text,
   'true'),
  ('anonymous caller cannot manage notifications',
   (not has_function_privilege('anon',
      'public.delete_notification_secure(uuid)', 'execute')
    and not has_function_privilege('anon',
      'public.mark_notifications_read_by_ids_secure(uuid[])', 'execute')
    and not has_function_privilege('anon',
      'public.delete_notifications_by_ids_secure(uuid[])', 'execute')
    and not has_function_privilege('anon',
      'public.mark_all_notifications_read_secure()', 'execute')
    and not has_function_privilege('anon',
      'public.delete_all_notifications_secure()', 'execute'))::text,
   'true');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_021_checks
order by check_name;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/patches/021-notification-management.sql
git commit -m "feat(db): fix the appointment push timezone, add notification management RPCs"
```

- [ ] **Step 3: Hand off to Davide**

Ask Davide to run this patch in the Supabase SQL editor after `020` and
confirm every row in the final `select` reads `PASS`. Task 4's manual
testing needs this applied first; Tasks 2-4's code changes build and lint
fine regardless.

---

### Task 2: `src/data/notifications.js` — five new functions, keys, and registrations

**Files:**
- Modify: `src/data/notifications.js`
- Modify: `src/lib/mutationKeys.js`
- Modify: `src/data/mutations.js`

**Interfaces:**
- Consumes: the five RPCs from Task 1.
- Produces: `deleteNotification({ id })`, `markNotificationsReadByIds({ ids })`,
  `deleteNotificationsByIds({ ids })`, `markAllNotificationsRead()`,
  `deleteAllNotifications()` in `src/data/notifications.js`.
  `mutationKeys.deleteNotification`, `mutationKeys.
  markNotificationsReadByIds`, `mutationKeys.deleteNotificationsByIds`,
  `mutationKeys.markAllNotificationsRead`, `mutationKeys.
  deleteAllNotifications`. Task 4's screen calls all five by these exact
  names.

- [ ] **Step 1: Add the five functions to `src/data/notifications.js`**

Append to the end of the file:

```js
/** Delete one notification. */
export async function deleteNotification({ id }) {
  const { error } = await supabase.rpc('delete_notification_secure', { p_id: id })
  if (error) throw error
}

/** Mark a specific set of this user's notifications read -- a selection. */
export async function markNotificationsReadByIds({ ids }) {
  const { error } = await supabase.rpc('mark_notifications_read_by_ids_secure', { p_ids: ids })
  if (error) throw error
}

/** Delete a specific set of this user's notifications -- a selection. */
export async function deleteNotificationsByIds({ ids }) {
  const { error } = await supabase.rpc('delete_notifications_by_ids_secure', { p_ids: ids })
  if (error) throw error
}

/** Mark every one of this user's notifications read. */
export async function markAllNotificationsRead() {
  const { error } = await supabase.rpc('mark_all_notifications_read_secure')
  if (error) throw error
}

/** Delete every one of this user's notifications, read or unread. */
export async function deleteAllNotifications() {
  const { error } = await supabase.rpc('delete_all_notifications_secure')
  if (error) throw error
}
```

- [ ] **Step 2: Add the five mutation keys to `src/lib/mutationKeys.js`**

The file currently has, at lines 26-27:

```js
  markNotificationRead: ['markNotificationRead'],
  markNotificationsRead: ['markNotificationsRead'],
```

Add these five lines right after them:

```js
  deleteNotification: ['deleteNotification'],
  markNotificationsReadByIds: ['markNotificationsReadByIds'],
  deleteNotificationsByIds: ['deleteNotificationsByIds'],
  markAllNotificationsRead: ['markAllNotificationsRead'],
  deleteAllNotifications: ['deleteAllNotifications'],
```

- [ ] **Step 3: Register the five mutations in `src/data/mutations.js`**

Change the top import line (currently):

```js
import { markNotificationRead, markNotificationsRead } from './notifications.js'
```

to:

```js
import {
  deleteAllNotifications, deleteNotification, deleteNotificationsByIds, markAllNotificationsRead,
  markNotificationRead, markNotificationsRead, markNotificationsReadByIds,
} from './notifications.js'
```

The file currently has, right after the `markNotificationsRead`
registration (around line 375):

```js
  queryClient.setMutationDefaults(mutationKeys.markNotificationsRead, {
    mutationFn: markNotificationsRead,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })
```

Add these five registrations right after it (before the "A paused mutation
restored without a registered function..." comment further down):

```js
  queryClient.setMutationDefaults(mutationKeys.deleteNotification, {
    mutationFn: deleteNotification,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markNotificationsReadByIds, {
    mutationFn: markNotificationsReadByIds,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteNotificationsByIds, {
    mutationFn: deleteNotificationsByIds,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markAllNotificationsRead, {
    mutationFn: markAllNotificationsRead,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteAllNotifications, {
    mutationFn: deleteAllNotifications,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (nothing calls these five yet — Task 4 is the
first caller — so this only proves the new code and registrations are
syntactically sound and correctly wired).

- [ ] **Step 5: Commit**

```bash
git add src/data/notifications.js src/lib/mutationKeys.js src/data/mutations.js
git commit -m "feat: data layer and mutation registrations for notification management"
```

---

### Task 3: Real-time badge — `AppLayout.jsx`

**Files:**
- Modify: `src/layouts/AppLayout.jsx`

**Interfaces:**
- Consumes: `supabase` (`src/lib/supabase.js`), `queryPrefixes.notifications`
  (`src/lib/queryKeys.js`, already exists).

- [ ] **Step 1: Add the Realtime channel**

Change the top of the file. Current imports (lines 1-14):

```js
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router'
import BottomNav from '../components/BottomNav.jsx'
import LiveSessionBar from '../components/LiveSessionBar.jsx'
import OfflineBanner from '../components/OfflineBanner.jsx'
import { LoadingState } from '../components/ScreenState.jsx'
import TopHeader from '../components/TopHeader.jsx'
import { fetchUnreadNotificationCount } from '../data/notifications.js'
import { fetchOpenRun } from '../data/runs.js'
import { elapsedMs } from '../features/workout/timer.js'
import { useAuth } from '../features/auth/useAuth.js'
import { queryKeys } from '../lib/queryKeys.js'
```

Change to:

```js
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router'
import BottomNav from '../components/BottomNav.jsx'
import LiveSessionBar from '../components/LiveSessionBar.jsx'
import OfflineBanner from '../components/OfflineBanner.jsx'
import { LoadingState } from '../components/ScreenState.jsx'
import TopHeader from '../components/TopHeader.jsx'
import { supabase } from '../lib/supabase.js'
import { fetchUnreadNotificationCount } from '../data/notifications.js'
import { fetchOpenRun } from '../data/runs.js'
import { elapsedMs } from '../features/workout/timer.js'
import { useAuth } from '../features/auth/useAuth.js'
import { queryKeys, queryPrefixes } from '../lib/queryKeys.js'
```

Inside `export default function AppLayout(...)`, right after the existing
`unread` query (which currently ends with the `refetchInterval: 60_000,`
line and its closing `})`), add:

```jsx
  const queryClient = useQueryClient()

  // The poll above is the fallback; this is what makes the badge update
  // without waiting up to 60s (or a full app reopen). Same pattern as
  // `useThreadMessages.js`'s chat channel: the query stays the source of
  // truth, Realtime only triggers a refetch. If the subscription never
  // fires, the poll still keeps the badge eventually correct.
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, queryClient])
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/AppLayout.jsx
git commit -m "feat: update the notification badge in real time"
```

---

### Task 4: List management — `NotificationsScreen.jsx`

**Files:**
- Modify: `src/features/notifications/NotificationsScreen.jsx` (full rewrite)

**Interfaces:**
- Consumes: everything from Task 2's `src/data/notifications.js` and
  `mutationKeys`.

- [ ] **Step 1: Rewrite `NotificationsScreen.jsx`**

```jsx
import { useState } from 'react'
import {
  Box, Button, Card, CardActionArea, CardContent, Checkbox, Chip, IconButton, Stack, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import {
  deleteAllNotifications, deleteNotification, deleteNotificationsByIds, fetchNotifications,
  markAllNotificationsRead, markNotificationsReadByIds,
} from '../../data/notifications.js'
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

/** One notification's title/body/type/time -- shared by both row layouts below. */
function NotificationText({ item }) {
  return (
    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
      <Typography variant="h3" noWrap sx={{ fontWeight: item.read_at ? 400 : 700 }}>
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
    </Box>
  )
}

/**
 * Every notification for the signed-in user, newest first. Shared by both
 * roles -- RLS already scopes the underlying table to the caller, and the
 * rendering is identical either way, exactly like `ProfileScreen.jsx`/
 * `SettingsScreen.jsx` already are.
 *
 * Opening a notification (outside selection mode) marks it read and
 * navigates -- it does not delete it. Deleting is always a separate,
 * explicit action: the per-row bin icon, a selection, or Delete all.
 */
export default function NotificationsScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all') // 'all' | 'unread'
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const notifications = useQuery({
    queryKey: queryKeys.notifications(user.id),
    queryFn: () => fetchNotifications(user.id),
  })

  const markRead = useMutation({ mutationKey: mutationKeys.markNotificationRead })
  const deleteOne = useMutation({ mutationKey: mutationKeys.deleteNotification })
  const markSelected = useMutation({ mutationKey: mutationKeys.markNotificationsReadByIds })
  const deleteSelected = useMutation({ mutationKey: mutationKeys.deleteNotificationsByIds })
  const markAll = useMutation({ mutationKey: mutationKeys.markAllNotificationsRead })
  const deleteAll = useMutation({ mutationKey: mutationKeys.deleteAllNotifications })

  if (notifications.isPending) return <LoadingState />
  // `data === undefined` means it never loaded. A refetch can fail while the
  // persisted cache still holds a good list; an error screen over usable
  // data would be the wrong answer for an offline gym.
  if (notifications.isError && notifications.data === undefined) {
    return <ErrorState error={notifications.error} onRetry={notifications.refetch} />
  }

  const all = notifications.data
  const visible = filter === 'unread' ? all.filter((item) => !item.read_at) : all

  const exitSelection = () => {
    setSelecting(false)
    setSelectedIds(new Set())
  }

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h1">Notifications</Typography>

      <Stack direction="row" spacing={1}>
        <Chip
          label="All"
          color={filter === 'all' ? 'primary' : 'default'}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        />
        <Chip
          label="Unread"
          color={filter === 'unread' ? 'primary' : 'default'}
          onClick={() => setFilter('unread')}
          aria-pressed={filter === 'unread'}
        />
      </Stack>

      {selecting ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography sx={{ flexGrow: 1 }}>{selectedIds.size} selected</Typography>
          <Button
            disabled={selectedIds.size === 0 || markSelected.isPending}
            onClick={() => {
              markSelected.mutate({ ids: [...selectedIds] })
              exitSelection()
            }}
          >
            Mark read
          </Button>
          <Button
            color="error"
            disabled={selectedIds.size === 0 || deleteSelected.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${selectedIds.size} notification${selectedIds.size === 1 ? '' : 's'}?`,
                )
              ) {
                deleteSelected.mutate({ ids: [...selectedIds] })
                exitSelection()
              }
            }}
          >
            Delete
          </Button>
          <Button onClick={exitSelection}>Cancel</Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1}>
          <Button onClick={() => setSelecting(true)} disabled={all.length === 0}>
            Select
          </Button>
          <Button onClick={() => markAll.mutate()} disabled={markAll.isPending}>
            Mark all read
          </Button>
          <Button
            color="error"
            disabled={all.length === 0 || deleteAll.isPending}
            onClick={() => {
              if (window.confirm('Delete every notification? This cannot be undone.')) {
                deleteAll.mutate()
              }
            }}
          >
            Delete all
          </Button>
        </Stack>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? 'Nothing unread' : 'Nothing yet'}
          description={
            filter === 'unread'
              ? 'Every notification is up to date.'
              : 'New messages, appointments and plans show up here.'
          }
        />
      ) : null}

      <Stack spacing={2}>
        {visible.map((item) => (
          <Card key={item.id}>
            {selecting ? (
              // A plain clickable Box, not `CardActionArea`: the row also
              // contains a `Checkbox`, and nesting one interactive control
              // inside another is invalid here for the same reason a
              // `CardActionArea` never wraps the delete `IconButton` below.
              <Box onClick={() => toggleSelected(item.id)} sx={{ p: 2, cursor: 'pointer' }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    // The row's own onClick already toggles selection; this
                    // control is visual state, not a second event source.
                    sx={{ pointerEvents: 'none', p: 0 }}
                    tabIndex={-1}
                  />
                  <NotificationText item={item} />
                </Stack>
              </Box>
            ) : (
              <Stack direction="row" sx={{ alignItems: 'stretch' }}>
                <CardActionArea
                  onClick={() => {
                    if (!item.read_at) markRead.mutate({ id: item.id })
                    navigate(item.url)
                  }}
                  sx={{ flexGrow: 1 }}
                >
                  <CardContent>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <NotificationText item={item} />
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
                <IconButton
                  aria-label={`Delete: ${item.title}`}
                  onClick={() => deleteOne.mutate({ id: item.id })}
                  sx={{ alignSelf: 'center', mr: 1 }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            )}
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint`
Expected: no errors — this also catches any nested-interactive-element
mistake MUI's own accessibility linting would flag.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/features/notifications/NotificationsScreen.jsx
git commit -m "feat: notification list management -- filter, delete, bulk actions"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 2: Confirm patch 021 is applied**

Ask Davide to confirm `021` shows a full `PASS` block in the Supabase SQL
editor (Task 1's handoff step).

- [ ] **Step 3: Manual click-through (Davide, in the worktree running `npm
      run dev`)**

1. **Real-time badge:** trigger a notification (e.g. send a chat message to
   the signed-in user from the other account) while the app is open and in
   the foreground. Confirm the badge updates within a couple of seconds,
   without reopening the app.
2. **Timezone:** confirm an appointment, check the resulting push/
   notification shows the correct local time (matching the time actually
   booked, not offset by the CEST/CET difference).
3. **Filter:** on `/m/notifications` or `/p/notifications`, confirm the
   Unread chip hides read notifications and All shows everything.
4. **Per-row delete:** tap the bin icon on one notification (outside
   selection mode) — it disappears immediately, no confirmation prompt.
5. **Selection mode:** tap Select, tap two or three notifications (rows
   show a checked checkbox, header shows "N selected"), tap Mark read —
   confirm they're marked read and selection mode exits. Repeat, this time
   tapping Delete — confirm a browser confirm dialog appears, accepting it
   removes exactly the selected rows.
6. **Mark all / Delete all:** with several notifications present, tap Mark
   all read — confirm every row becomes read with no confirmation prompt.
   Then tap Delete all — confirm a browser confirm dialog appears, and
   accepting it empties the list regardless of read state.
