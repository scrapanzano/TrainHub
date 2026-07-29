# Task 11 report: Appointment detail and booking

## What I implemented

1. `src/data/appointments.js` — appended `createAppointment` (client-generated `id`,
   upsert with `onConflict: 'id', ignoreDuplicates: true`) and `setAppointmentStatus`
   (update by id, returns `id, status`). Transcribed verbatim from the brief.
2. `src/lib/mutationKeys.js` — added `createAppointment: ['createAppointment']` and
   `setAppointmentStatus: ['setAppointmentStatus']`.
3. `src/data/mutations.js` — imported both writes and registered them via
   `setMutationDefaults`:
   - `createAppointment`: `onSettled` invalidates `queryPrefixes.agenda`. No scope
     (booking is insert-only; no ordering hazard between two bookings).
   - `setAppointmentStatus`: `scope: { id: 'appointmentStatus' }` on the registered
     default (not the call site), `onSettled` invalidates both `queryPrefixes.agenda`
     and `queryPrefixes.appointment`.
4. `src/features/calendar/NewAppointmentSheet.jsx` — replaced the four-line
   `return null` stub with the full bottom-sheet: client select (via `fetchClients`),
   kind select, native date/time inputs, duration select, notes, offline/error
   `Alert`s, submit button. `crypto.randomUUID()` is called inside `onSubmit`, not
   during render. `slotToISO` builds timestamps from local date/time parts
   (`new Date(year, month-1, day, hour, minute)`), never via `new Date('YYYY-MM-DD')`.
5. `src/features/calendar/AppointmentDetailScreen.jsx` — new screen. Reads via
   `fetchAppointment`, gates its error state on `appointment.data === undefined`
   (not `isError` alone), renders kind/day/time/status chip, client card linking to
   `/p/clients/:clientId`, notes card, and status-transition buttons scoped by
   current status: `pending` → Confirm/Cancel; `confirmed` → Mark as
   completed/Cancel; `cancelled` → Reinstate only. A `cancelled` appointment cannot
   be marked `done` directly from this UI.
6. `src/routes/index.jsx` — replaced the `calendar/:appointmentId` placeholder with
   a lazy route pointing at `AppointmentDetailScreen.jsx`. `calendar/availability`
   left untouched as a placeholder (Task 12's job).

## Columns checked against `supabase/schema.sql`

`appointments` table: `id, member_id, pro_id, kind, status, starts_at, ends_at,
notes, created_at`, with `check (ends_at > starts_at)`. Every column written by
`createAppointment` (`id, member_id, pro_id, kind, status, starts_at, ends_at,
notes`) and `setAppointmentStatus` (`status`, filtered by `id`) exists on the
table. `status` is `appointment_status` enum (`pending, confirmed, cancelled,
done`) — matches `STATUS_LABEL` and the branching in the detail screen.

## Commands run

- `npm run lint` — exit 0, no output.
- `npm run build` — succeeded (`vite build` then PWA service worker build, no
  errors). No unresolved imports; no icon glyphs were introduced in this task.

## Files changed (staged and committed)

- `src/data/appointments.js`
- `src/data/mutations.js`
- `src/lib/mutationKeys.js`
- `src/features/calendar/NewAppointmentSheet.jsx`
- `src/features/calendar/AppointmentDetailScreen.jsx` (new)
- `src/routes/index.jsx`

`.superpowers/sdd/progress.md` was left modified but unstaged/uncommitted, per
instructions to stage only the task's named files.

## Self-review findings

- `crypto.randomUUID()` is called inside `onSubmit`, not in the render body. Confirmed.
- The `scope: { id: 'appointmentStatus' }` is on the registered default in
  `src/data/mutations.js`, not on the call-site `useMutation({ mutationKey: ... })`
  in `AppointmentDetailScreen.jsx`. Confirmed.
- No call site passes `onSettled` to `useMutation`. Both screens only use
  `mutationKey` at the call site, and `NewAppointmentSheet` passes a per-call
  `onSuccess` to `mutate(vars, { onSuccess })`, which is the safe per-call
  mechanism, not `onSettled`. Confirmed.
- The placeholder `return null` sheet is fully replaced — no leftover stub path.
- Nothing was added beyond the brief's code. No extra deps, no extra files, no
  `eslint-disable` anywhere.

## Browser checks deferred to the human

Per the task brief's Step 6, these require a browser/DB and were not run:

1. `/p/calendar`, tap `+` — sheet opens with the selected day pre-filled; book a
   60-minute training with a client; sheet closes and the appointment appears in
   that day's list (and on the agenda if today).
2. Tap the new card — detail screen shows client, day, time range; status buttons
   match the current status only.
3. Cancel then reinstate — chip and buttons follow the status.
4. From `/p`, tap `+` — lands on the calendar with the sheet open.
5. Offline round trip: book while offline (button reads "Saved offline"), go
   back online, confirm it appears without a reload.

## Fix: booking sheet state reset on open

### Root cause

`NewAppointmentSheet` is rendered unconditionally by `CalendarScreen` — only the
`Drawer`'s `open` prop toggles visibility, so the sheet component never unmounts.
Every field (`memberId`, `kind`, `day`, `time`, `minutes`, `notes`) was initialised
with `useState(...)`, whose initialiser runs exactly once, at first mount. Two
bugs followed: the `day` field froze at whatever `defaultDayISO` was on first
mount and never tracked later calendar selections, and every field kept the
previous booking's values across a close/reopen cycle.

### Pattern used, and why not an effect

Used React's documented "adjust state when a prop changes" pattern: a second
piece of state (`wasOpen`) compared against the current `open` prop during
render, with the reset performed inline in that same render when a transition
from closed to open is detected — not in a `useEffect`.

This mirrors the precedent already in this codebase: `useLiveSession`
(`src/features/workout/useLiveSession.js`) tracks `loadedFor` against `sessionId`
the same way, with the comment explaining that an effect fires in the same
commit as the render that changes the prop, so it would read state that hasn't
been corrected yet. The same hazard applies here — `CalendarScreen`'s `Fab`
sets `?new=1` and `selected` in the same interaction path, so an effect keyed on
`open` could commit before `day` had a chance to pick up the latest
`defaultDayISO`. Comparing during render avoids that entirely: by the time the
sheet's own JSX renders, `day` (and every other field) already holds the reset
value.

A ref was not used to track the previous `open` value because this repo's
ESLint config enables `react-hooks/refs`, which forbids reading `ref.current`
during render — exactly what comparing "previous open" against "current open"
would require every render.

### Walkthrough: failure (a) — stale day

Before the fix:
1. Professional opens `/p/calendar` — `selected` starts at today, sheet is
   mounted once with `day` initialised from that first `defaultDayISO`.
2. Professional taps next Tuesday — `CalendarScreen`'s `selected` state updates,
   which changes the `defaultDayISO` prop passed to the sheet, but the mounted
   sheet's own `day` state is untouched by a prop change.
3. Professional taps `+` — `Drawer` opens. `day` still holds today's date, not
   next Tuesday.

After the fix:
1. Same steps 1–2.
2. Professional taps `+` — `open` flips from `false` to `true`. On this render,
   `open !== wasOpen`, so the reset block runs: `setDay(defaultDayISO)` picks up
   the *current* prop value, which by now is next Tuesday's ISO date (because
   `CalendarScreen` already re-rendered with the new `selected` before the sheet
   re-renders with `open=true`). The sheet opens pre-filled with next Tuesday,
   satisfying the plan's acceptance test.

### Walkthrough: failure (b) — stale form across bookings

Before the fix:
1. Professional books an appointment: picks a client, sets kind to "Nutrition
   Consultation", a time, a duration, and writes notes. Submits.
   `onSuccess: () => onClose()` closes the sheet, but no field is cleared.
2. Professional taps `+` again to book someone else. The sheet reopens with the
   previous client, "Nutrition Consultation", the old time, duration and notes
   still in place. Changing only the client silently carries the rest into the
   new booking.

After the fix:
1. Same booking as above; sheet closes via `onClose()`, `open` becomes `false`.
   `wasOpen` catches up to `false` on the next render (the reset block only
   fires on the `false → true` edge, so nothing resets yet — correctly, since a
   closed sheet showing stale values off-screen doesn't matter).
2. Professional taps `+` again — `open` flips `false → true`. The reset block
   runs and every field is set back to its empty/default value before the
   professional sees the sheet.

### Confirmation: every field is reset

All six pieces of form state are set in the reset block, matching the sheet's
full field list:

- `memberId` → `''` (client select, no client pre-picked)
- `kind` → `'training'` (matches the field's original default)
- `day` → `defaultDayISO` (the current prop, fixing bug (a))
- `time` → `'09:00'` (matches the field's original default)
- `minutes` → `60` (matches the field's original default)
- `notes` → `''`

Nothing else in the file changed: `slotToISO`, the `create` mutation call,
`Drawer`'s accessibility props (`role`, `aria-labelledby`), and the
`mutationKeys.createAppointment` registration are all untouched.

### Commands run

```
$ npm run lint
> trainhub@0.0.0 lint
> eslint .
(exit 0, no output — no warnings, no errors, no suppressions added)

$ npm run build
> trainhub@0.0.0 build
> vite build
...
✓ built in 691ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
...
precache  62 entries (1094.78 KiB)
files generated
  dist/sw.js
(exit 0)
```

### Commit

```
c66cdce fix(pro): reset the booking sheet each time it opens
 1 file changed, 22 insertions(+)
```

Only `src/features/calendar/NewAppointmentSheet.jsx` was staged and committed —
`.superpowers/sdd/progress.md`'s working-tree changes were left untouched, per
the task's "stage only the files you actually changed" constraint.
