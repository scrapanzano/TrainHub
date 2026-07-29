# Task 10 report: Calendar with week and month views

## What I implemented

1. `src/components/WeekStrip.jsx` — seven selectable day buttons in a horizontal
   scroll strip, each with `aria-label` = full ISO date, `aria-current="date"`
   when selected, and a decorative (`aria-hidden`) marker dot coloured by
   `task.{kind}` from the `markers` map. Transcribed verbatim from the brief.

2. `src/components/MonthGrid.jsx` — a 7-column CSS grid: an `aria-hidden`
   weekday-initials header row (from `WEEKDAY_INITIALS` in `month.js`), then
   one button per cell with the same `aria-label`/`aria-current`/marker-dot
   treatment as the week strip, dimming padding days that belong to a
   neighbouring month. Transcribed from the brief with one change (see
   "Deviation" below).

3. `src/features/calendar/NewAppointmentSheet.jsx` — the placeholder specified
   in the task instructions (Task 11 replaces it):
   ```jsx
   // Placeholder. Task 11 replaces this with the real booking sheet.
   export default function NewAppointmentSheet() {
     return null
   }
   ```

4. `src/features/calendar/CalendarScreen.jsx` — the `/p/calendar` screen.
   Computes the visible month's `monthGrid()` from the selected day, derives
   `rangeFrom`/`rangeTo` from the grid's first and last cell, and issues a
   single `useQuery` keyed on `queryKeys.agendaRange(user.id, rangeFrom, rangeTo)`
   calling `fetchAppointmentsInRange`. Builds a per-day `markers` map (first
   appointment's `kind` per day) and an `onDay` list (appointments matching the
   selected day) by grouping `appointment.starts_at` through
   `new Date(...).toLocaleDateString('sv-SE')` — used at both grouping sites,
   unmodified from the brief. Toggles between `WeekStrip` and `MonthGrid` via
   `expanded` state and the chevron `IconButton`. Steps months with `shiftMonth`
   and clamps the selected day to the target month's last day. Opens
   `NewAppointmentSheet` via a `?new=1` search param set by the FAB. Renders
   `LoadingState`/`ErrorState`/`EmptyState` gated on `appointments.data === undefined`
   for the error branch, matching the project's offline-first convention.
   Transcribed verbatim from the brief.

5. `src/routes/index.jsx` — replaced the `{ path: 'calendar', ...screen('Calendar') }`
   placeholder with the lazy-loaded route pointing at `CalendarScreen.jsx`, exactly
   as specified. `calendar/availability` and `calendar/:appointmentId` left as
   placeholders for Tasks 11/12.

## Deviation from the brief (required to pass lint)

The brief's `MonthGrid.jsx` code imports `Stack` from `@mui/material` but never
uses it in the component body. With `no-unused-vars` this fails
`npm run lint`, and the task's global constraints forbid `eslint-disable` of
any kind ("If lint objects, the code is wrong"). I removed `Stack` from the
import list — no functional or visual change, since it was never referenced.
Every other line of `MonthGrid.jsx`, and all of `WeekStrip.jsx` and
`CalendarScreen.jsx`, are unmodified transcriptions of the brief.

## Commands run

`npm run lint`
```
> trainhub@0.0.0 lint
> eslint .
```
Exit 0 (after removing the unused `Stack` import above; first run failed with
one `no-unused-vars` error on that line).

`npm run build`
```
> trainhub@0.0.0 build
> vite build
...
✓ built in 659ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
✓ built in 62ms
PWA v1.3.0
mode      injectManifest
precache  58 entries (1087.10 KiB)
files generated
  dist/sw.js
```
Succeeded, including the service worker precache build. `dist/assets/CalendarScreen-*.js` is present in the chunk list, confirming the lazy route resolved and built.

## Files changed

- `src/components/WeekStrip.jsx` (new)
- `src/components/MonthGrid.jsx` (new)
- `src/features/calendar/NewAppointmentSheet.jsx` (new, placeholder)
- `src/features/calendar/CalendarScreen.jsx` (new)
- `src/routes/index.jsx` (modified — only the `calendar` route entry)

`git show --stat HEAD` confirms exactly these 5 files, 301 insertions / 1
deletion. No other files were staged; `.superpowers/sdd/progress.md`, which
was already modified in the working tree before this task started, was left
untouched and unstaged.

## Self-review

- **One appointments query, keyed on the month grid's bounds?** Yes — a single
  `useQuery` call with `queryKeys.agendaRange(user.id, rangeFrom, rangeTo)`,
  where `rangeFrom`/`rangeTo` come from `cells[0].dateISO` / `cells.at(-1).dateISO`
  of the same `monthGrid()` call used to render the grid. No per-day queries.
- **`toLocaleDateString('sv-SE')` preserved at both use sites?** Yes — in the
  `markers` loop and in the `onDay` filter, both unchanged from the brief.
- **Anything added the brief didn't ask for?** No. I only removed the unused
  `Stack` import from `MonthGrid.jsx` (a subtraction, not an addition) to
  satisfy the "no eslint-disable" constraint; everything else is a verbatim
  transcription.
- **Is the placeholder sheet obviously a placeholder?** Yes — its only content
  is the comment `// Placeholder. Task 11 replaces this with the real booking
  sheet.` directly above a component that renders `null` and ignores all
  props, matching the instructions exactly.
- Confirmed `src/features/calendar/month.js` has zero diff between `HEAD~1`
  and `HEAD` (`git diff HEAD~1 HEAD -- src/features/calendar/month.js`
  produced no output) — its self-check was not touched.
- Confirmed only the `calendar` entry changed in `src/routes/index.jsx`
  (`calendar/availability` and `calendar/:appointmentId` remain
  `...screen(...)` placeholders).

## Browser checks deferred to the human

No browser or database is available in this environment. Per the brief's
Step 5, the human should verify at `/p/calendar` as Coach Andrea:

- Current month's label, week strip with today highlighted, and today's
  appointments listed below on load.
- Tapping the chevron expands to the whole month grid with dots on days that
  have appointments, and collapses back to the week strip.
- Stepping back/forward a month updates the label and grid, and the day list
  empties for a month with nothing booked.
- Stepping from 31 March to February lands the selection on 28 (or 29 in a
  leap year), not 3 March.
- Tapping a greyed padding day at the start of the grid moves the visible
  month to the one that day belongs to.
