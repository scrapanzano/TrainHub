# Notification center: a real bell instead of a chat shortcut

## Context

The notification bell (`TopHeader.jsx`) is not a notification system today —
`notificationCount` is `fetchUnreadCount` from `src/data/chat.js` (chat
messages only) and `notificationHref` is hardcoded to the chat route. The
bell icon and its `aria-label` ("unread messages") are the only things that
say "notification"; clicking it always opens chat, regardless of what
actually happened.

Four real events already exist server-side (`supabase/patches/010-push-
notifications.sql`): a new chat message, an appointment reaching
`confirmed`/`cancelled`/`done`, a new workout plan, a new nutrition plan.
Each already fires an external Web Push via `notify_user()` — but nothing is
persisted. There is no `notifications` table, so there is nothing to list,
nothing to mark read, and nothing for a tapped OS push notification to
reconcile against. Building a real bell — a list of unread notifications,
each linking to the page that generated it, clearing when read either from
inside the list or from outside it — requires a persistence layer that does
not exist yet, not just a routing fix.

Confirmed with Davide: all four event types belong in the bell, including
chat (one system, not one bell for "everything but chat"), and the bell
opens a dedicated screen (matching `ThreadListScreen`'s pattern — this
project never uses a dropdown/popover for a list), not a popover.

## 1. Schema: `notifications` table + patch

New table, patch `020-notifications.sql` (after `019`):

```sql
create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,  -- 'message' | 'appointment' | 'workout_plan' | 'nutrition_plan'
  title      text not null,
  body       text,
  url        text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read_at, created_at desc);
```

RLS: `select` scoped to `auth.uid() = user_id`. No direct `insert`/`update`/
`delete` grant to `authenticated`/`anon` — matching this project's
established pattern (`RLS is the security boundary, and it is not the first
gate`, CLAUDE.md), every write goes through a `security definer` function:

- `notify_user()` (patch 010) gains one parameter, `p_type text`, and now
  inserts a `notifications` row before it fires the existing push. One choke
  point populates the table; the four existing trigger functions
  (`notify_on_message`, `notify_on_appointment_status`,
  `notify_on_workout_plan`, `notify_on_nutrition_plan`) each pass their own
  `p_type` — no duplicated insert logic.
- `mark_notification_read_secure(p_id uuid)` — marks one row read (the caller
  owns it, checked the same way every other `*_secure` function checks
  ownership). Used by tapping a row in the notification list.
- `mark_notifications_read_secure(p_url text)` — marks every one of the
  caller's own unread rows whose `url` matches, read. Used by a destination
  screen on mount, so a notification clears when its target is actually
  seen, however the user got there.

## 2. Read state: matches the chat precedent already in the app

- Opening the notification screen does not mark anything read — it only
  lists what is already there. This matches what Davide described:
  "read" means the target was actually visited, not that the list was
  glanced at.
- Tapping a row: `mark_notification_read_secure(id)`, then navigate to its
  `url` — one action, not two.
- Visiting the destination screen through any other path (bottom nav, a
  direct link, browser history) also clears it: each destination screen
  (`ThreadScreen.jsx`, `MemberAppointmentsScreen.jsx`,
  `WorkoutPlanScreen.jsx`, `MemberNutritionScreen.jsx`) calls
  `mark_notifications_read_secure(url)` once on mount, the same shape
  `ThreadScreen.jsx` already uses today for `markThreadRead` — this is not a
  new interaction pattern, it is the existing one extended to three more
  screens.
- An OS push notification tapped from outside the app: `sw.js`'s
  `notificationclick` already just navigates to the payload's `url` — since
  the destination screen now clears its own notifications on mount
  regardless of entry path, this closes the loop for free. No change needed
  in `sw.js` itself.

## 3. UI

- `/m/notifications` and `/p/notifications`, new screens, same list-screen
  shape as `ThreadListScreen.jsx`: title, body preview, relative time,
  unread visually distinguished, tap navigates (and marks read).
- `TopHeader.jsx`: `notificationHref` becomes the new route instead of the
  chat route; `notificationCount` comes from a count of the caller's own
  unread `notifications` rows (all four types) instead of
  `fetchUnreadCount`. The `aria-label` stops saying "messages."
- Minor, noted and accepted: the member has no dedicated Chat entry in
  bottom nav (`navItems.js`) today, only "My Trainer" → chat, and currently
  gets to chat in one tap from the bell. After this change reaching chat via
  the bell is one more tap (bell → notification row → chat) when the news is
  a message — the same number of taps a workout-plan or appointment
  notification already takes, and "My Trainer" remains the direct path to
  chat regardless of any unread notification.

## Out of scope

- Redesigning `MyTrainerScreen`'s navigation to add a first-class Chat entry
  for the member — raised and dropped in this conversation, not part of what
  was asked.
- New notification types. All four triggers in `patches/010` notify only the
  MEMBER (`notify_user(new.member_id, ...)`) — a professional's own list will
  only ever contain messages, since nothing today notifies the professional
  of, say, a new appointment request (`'pending'` is explicitly excluded:
  "not news to anyone yet"). Pre-existing behavior, not changed here; adding
  a professional-facing event is a separate decision.
