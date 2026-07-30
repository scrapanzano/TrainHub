# Task 7 report: member appointments and booking

## What was implemented

1. **`src/data/appointments.js`** — added `fetchMemberAppointmentsInRange(memberId, fromISO, toISO)`,
   verbatim from the brief: the member's mirror of `fetchAppointmentsInRange`, filtering on
   `member_id` and embedding the professional via `pro:profiles!appointments_pro_id_fkey`.
   Carries `.retry(navigator.onLine)` like every other read in the file.

2. **`src/features/trainer/BookingSheet.jsx`** (new) — the member's booking `Drawer`, verbatim
   from the brief. No client picker; `pro_id` comes from `profile.assigned_pro_id`, `member_id`
   from `user.id`, status starts at `'pending'` (the professional confirms). Same closed→open
   reset pattern as `NewAppointmentSheet.jsx` (compared during render, not in an effect), same
   client-generated `crypto.randomUUID()` id generated in the submit handler, same offline/error/
   pending button states.

3. **`src/features/trainer/MemberAppointmentsScreen.jsx`** (new) — verbatim from the brief. Month
   grid with per-day kind-coloured markers, selected day's list via `AppointmentCard`, a "Book for
   this day" card that opens `BookingSheet`, and a "No professional yet" `EmptyState` in its place
   when `profile.assigned_pro_id` is unset. One `<h1>` (month label), one `<h2>` (day heading), one
   `<h3>` (card title / activity count) — no level skipped or doubled.

4. **`src/routes/index.jsx`** — replaced the `trainer/appointments` `Placeholder` with the lazy
   route from the brief.

5. **Two files beyond the brief's list — a cache-invalidation gap, fixed at the shared
   registration:**
   - `src/lib/queryKeys.js` — added `queryPrefixes.appointments: ['appointments']`, mirroring the
     existing `agenda` prefix comment. `appointmentsOnDay` and the new `memberAppointments` both
     start with `'appointments'`.
   - `src/data/mutations.js` — `createAppointment`'s registered `onSettled` now also invalidates
     `queryPrefixes.appointments`, alongside the pre-existing `queryPrefixes.agenda` invalidation.

   **Why:** `createAppointment` was already registered (per the brief's pointer to check first),
   but its `onSettled` invalidated only `queryPrefixes.agenda` (`['agenda']`). That was correct
   while only the professional's `NewAppointmentSheet` called it — the professional's own queries
   are all `agenda`-prefixed. Task 7 makes the *member's* `BookingSheet` call the same mutation,
   and the member's queries (`appointmentsOnDay`, `memberAppointments`) are `appointments`-prefixed
   — a different first array element, so `invalidateQueries({queryKey: ['agenda']})` never matches
   them (TanStack Query's default invalidation is a queryKey-prefix match). With `staleTime: 30_000`
   and `refetchOnWindowFocus: false` in `src/lib/queryClient.js`, and no remount between booking and
   viewing the list (`onSuccess` just closes the drawer, same screen instance), a freshly booked
   appointment would not have appeared in the day's list until the 30s staleTime happened to lapse
   and something else triggered a refetch — silently failing the brief's own verification step
   ("request a 60-minute training — it appears in the list"). Fixed once in the shared mutation
   registration rather than adding a per-call `onSuccess` invalidation at the `BookingSheet` call
   site, per the project's own convention that a call site should not carry logic the registration
   is supposed to own, and so the same fix also benefits `MemberHomeScreen`'s `appointmentsOnDay`
   query for any future member-initiated booking flow.

   This does not touch `setAppointmentStatus`'s registration (professional confirming/cancelling):
   the brief's verification only requires the professional to see the pending request on `/p` and
   `/p/calendar`, not the member to see the confirmation land live without a remount, and the
   existing remount-triggered refetch behaviour (`refetchOnMount` default) already covers that case
   the same way every other screen in the app does.

## Verified

**Lint** — `npm run lint`, exit 0, no output:
```
> trainhub@0.0.0 lint
> eslint .
```

**Build** — `npm run build`, succeeded, service worker built:
```
> trainhub@0.0.0 build
> vite build
...
✓ built in 626ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
...
✓ built in 156ms
PWA v1.3.0
mode      injectManifest
format:   es
precache  76 entries (1128.79 KiB)
files generated
  dist/sw.js
```

**Self-checks** — none added. This task's new logic (`slotToISO`, `dayOf`, `step`'s month-clamp)
mirrors patterns already shipped without a self-check (`NewAppointmentSheet.jsx`'s identical
`slotToISO`, `CalendarScreen.jsx`'s identical month-step-and-clamp), and `month.js` — the actual
date arithmetic both screens depend on — already has `month.selfcheck.js`, which covers the
`shiftMonth`/`monthGrid` behaviour this screen calls into. Ran it to confirm nothing in that shared
logic broke:
```
node src/features/calendar/month.selfcheck.js
```
(exit 0, no output — all asserts passed)

**Not run — needs a human with database credentials**, per the brief:
> As Daniel, `/m/trainer/appointments` shows the month with dots on the seeded days. Select a day,
> tap the booking card, request a 60-minute training — it appears in the list as "Not confirmed
> yet", and Coach Andrea sees it on `/p` and `/p/calendar` with Confirm available. **Step from 31
> March back a month** and confirm the selection lands on 28 February.

## Files changed

- `src/data/appointments.js` — added `fetchMemberAppointmentsInRange`
- `src/features/trainer/BookingSheet.jsx` — new
- `src/features/trainer/MemberAppointmentsScreen.jsx` — new
- `src/routes/index.jsx` — wired `/m/trainer/appointments`
- `src/lib/queryKeys.js` — added `queryPrefixes.appointments`
- `src/data/mutations.js` — `createAppointment` now also invalidates `queryPrefixes.appointments`

## Self-review findings

- Confirmed `AddIcon`, `ChevronLeftIcon`, `ChevronRightIcon` exist in the installed
  `@mui/icons-material` before use (`Add.js`, `ChevronLeft.js`, `ChevronRight.js` present on disk).
- Confirmed `profile.assigned_pro_id` is the real field name used elsewhere (`BrowseTrainersScreen`,
  `MyTrainerScreen`, `AuthProvider`, `data/profile.js`), not a brief invention.
- Confirmed no `onSettled` passed at either mutation call site (`BookingSheet.jsx` only uses
  `mutate(vars, { onSuccess })`, which is the safe per-call mechanism).
- Confirmed the write (`createAppointment`) carries no `.retry(...)` and the read
  (`fetchMemberAppointmentsInRange`) does — matches the project's read/write retry rule.
- Confirmed `id: crypto.randomUUID()` is generated inside `onSubmit` (an event handler), not in the
  render body — satisfies `react-hooks/purity` and the replay-idempotence requirement.
- Found and fixed the cache-invalidation gap described above (`queryPrefixes.appointments`).
- Did not add a self-check file: no new pure/branchy logic was introduced beyond what's already
  covered by `month.selfcheck.js`, and the brief did not call one out.
- Kept `.superpowers/sdd/*` scratch files (pre-existing uncommitted changes from earlier tasks) out
  of this commit — staged and committed only the six files above.

## Issues or concerns

- The browser walkthrough in the brief's Step 4 (seeded dots, live booking, Coach Andrea's view,
  the 31 March → 28 February step) needs a human with Supabase credentials and cannot be run from
  here.
- The `queryPrefixes.appointments` / `mutations.js` fix goes beyond the brief's literal file list
  (`src/data/appointments.js src/features/trainer src/routes/index.jsx`) and its `git add` command.
  I judged it necessary because, unfixed, the feature would silently fail its own acceptance
  criterion. I staged and committed it alongside the brief's files; flagging here in case a
  reviewer wants it split into its own commit instead.
