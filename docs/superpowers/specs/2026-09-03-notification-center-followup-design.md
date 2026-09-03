# Notification center: real-time badge, correct local time, and list management

## Context

Davide's manual test pass of `notification-center` (branch pushed,
`patches/018-020` applied and passing) found every scenario correct except
one already-known, unrelated gap (Nutrition Plan creation still needs the
wizard-style refactor the Workout Plan flow already got — tracked
separately, out of scope here) and three real problems worth fixing before
merge:

1. The bell's unread badge only updates on a 60-second poll
   (`AppLayout.jsx`) or on reopening the app — not in real time.
2. Nothing removes a notification once read. The list only grows.
3. The push notification for an appointment reaching `confirmed`/
   `cancelled` shows the wrong time (an appointment at 10:12 local reads
   8:00).

## A. Real-time badge

`AppLayout.jsx`'s unread count is a plain polled query. This app already has
the right pattern for "keep a query fresh when a row lands server-side
without a client-initiated write" — `useThreadMessages.js`'s Realtime
channel, filtered to one thread, invalidating the query on `INSERT`. The
fix is the same pattern at the shell level: a `postgres_changes` channel on
`notifications`, filtered to `user_id=eq.<the signed-in user>`, subscribed
in `AppLayout.jsx` alongside the existing poll (kept as a fallback — the
same reasoning `useThreadMessages.js`'s own doc comment already gives: "If
the subscription never fires, the screen still works; it just stops
updating on its own"). On `INSERT`, invalidate `queryPrefixes.notifications`
— which already covers both the badge count and the list screen, so both
update together with no extra plumbing.

## B. Timezone bug in the appointment push

`notify_on_appointment_status()` (`patches/010`, unchanged until now) does:

```sql
to_char(new.starts_at, 'Dy DD Mon at HH24:MI')
```

`starts_at` is `timestamptz`, stored UTC; `to_char` formats it in the
session's timezone, which defaults to UTC inside a trigger — not
Europe/Rome. The reported 8:00-instead-of-10:12 is exactly the 2-hour CEST
offset, confirming the diagnosis. Fix, matching the pattern already used for
`reward_day` in `patches/016`:

```sql
to_char(new.starts_at at time zone 'Europe/Rome', 'Dy DD Mon at HH24:MI')
```

## C. Managing the notification list

Five new RPCs (all `security definer`, scoped to `auth.uid()`, matching the
shape of the two already in `patches/020`):

- `delete_notification_secure(p_id uuid)` — delete one.
- `mark_notifications_read_by_ids_secure(p_ids uuid[])` — mark a selected
  set read.
- `delete_notifications_by_ids_secure(p_ids uuid[])` — delete a selected
  set.
- `mark_all_notifications_read_secure()` — mark every one of the caller's
  unread rows read.
- `delete_all_notifications_secure()` — delete every one of the caller's
  rows, read or unread.

`NotificationsScreen.jsx` gains:

- An **All / Unread** filter (`Chip` row, the same pattern already in
  `ThreadListScreen.jsx`), filtering the rendered list client-side —
  `fetchNotifications` already returns everything, no new query needed.
- Outside selection mode: unchanged tap-to-open-and-mark-read behavior, plus
  a per-row delete `IconButton`/`DeleteOutlineIcon` (the same component
  already used identically in `PlanSummary.jsx` and `SessionForm.jsx`).
  Header row gains **Select**, **Mark all read**, and **Delete all** — both
  act on every notification the user has, independent of the All/Unread
  filter currently showing, so the action's effect matches its label
  exactly. **Delete all** is behind a `window.confirm`, matching this
  codebase's established destructive-action pattern; it removes every
  notification regardless of read state.
- Entering selection mode (the **Select** button) turns each card into a
  checkbox row — tapping a card toggles its selection instead of
  navigating, and the per-row delete icon is hidden (redundant with bulk
  delete while a selection is active). The header becomes "N selected" +
  **Mark read** + **Delete** (both act only on the selected set; delete
  behind `window.confirm`) + **Cancel** (exits selection mode, clears the
  selection, returns to the normal header).

No new dependency: selection is a plain `Set` of ids in component state, no
gesture library, no swipe handling — deliberately dropped in favor of this
in this conversation's design discussion, since nothing in this project
uses gesture-based interaction anywhere and a checkbox-driven selection mode
needs none.

## Out of scope

Nutrition Plan creation's own refactor — acknowledged, tracked separately,
not touched here.
