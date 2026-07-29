# Task 3 report: Professional read layer — clients and agenda

## What I implemented

1. **`src/lib/queryKeys.js`** — added `clients`, `client`, `agendaOnDay`, `agendaRange`,
   `appointment`, `nutritionPlan`, `availability`, `bodyMetrics`, `clientTraining` to
   `queryKeys`, and `clients`, `agenda`, `appointment`, `nutritionPlan`, `availability`,
   `bodyMetrics` to `queryPrefixes` — transcribed verbatim from the brief.
2. **`src/data/clients.js`** (new) — `fetchClients(proId)` (roster, filtered by
   `assigned_pro_id`, embeds `workout_plans` for the current goal) and
   `fetchClient(clientId)` (dossier header). Transcribed verbatim from the brief.
3. **`src/data/appointments.js`** — appended `fetchAgendaOnDay`, `fetchAppointmentsInRange`,
   `fetchAppointment`, sharing the `AGENDA_COLUMNS` constant that embeds the member side
   of the relationship. Transcribed verbatim from the brief.
4. **`src/components/AppointmentCard.jsx`** — refactored per Step 4 (see below).
5. **`src/features/home/MemberHomeScreen.jsx`** — updated the one call site to pass
   `person={appointment.pro}`.

## The `AppointmentCard` refactor

- Changed: signature from `{ appointment }` to `{ appointment, person, to }`; every
  `pro?.` reference became `person?.`; the `<CardContent>` body was pulled out into a
  `body` const and wrapped in `<CardActionArea component={Link} to={to}>` when `to` is
  given, otherwise rendered directly inside `<Card>`; added `CardActionArea` to the MUI
  import and `Link` from `react-router` (the installed package is the unified
  `react-router` v8, matching the brief's import).
- Preserved exactly as before: the `<Card sx={{ bgcolor: settled ? 'task.done' :
  \`task.${kind}\`, border: 'none' }}>` styling, the `statusLabel` map (`done` /
  `cancelled` / `confirmed` / `pending` / default `'Scheduled'`), and the `titleAccess=
  {statusLabel}` on both `CheckCircleIcon` and `RadioButtonUncheckedIcon`. Nothing in
  that logic moved or changed — only the prop the avatar/name block reads from.

## Grep for other call sites

```
grep AppointmentCard src -rn
```
Result: only `src/components/AppointmentCard.jsx` (definition) and
`src/features/home/MemberHomeScreen.jsx` (the one usage) reference it. No other
consumer exists in the repo, so no other call site needed updating.

## Columns checked against `supabase/schema.sql`

- `profiles`: `id`, `full_name`, `avatar_url`, `bio`, `assigned_pro_id`,
  `subscription_status`, `subscription_until`, `created_at` — all present (lines 13-26).
- `workout_plans`: `member_id`, `author_id`, `goal`, `created_at` — all present
  (lines 42-52); default FK name `workout_plans_member_id_fkey` matches Postgres's
  auto-generated constraint naming for `member_id references profiles(id)`.
- `appointments`: `id`, `kind`, `status`, `starts_at`, `ends_at`, `notes`, `member_id`,
  `pro_id` — all present (lines 130-143); default FK names
  `appointments_member_id_fkey` / `appointments_pro_id_fkey` match the same
  auto-naming convention, consistent with the existing `fetchAppointmentsOnDay`
  query that already uses `appointments_pro_id_fkey`.

## Commands run

- `npm run lint` → exit 0, no output beyond the script banner.
- `npm run build` → succeeded; Vite client build completed (`✓ built in 736ms`) and
  the PWA service-worker build completed (`✓ built in 125ms`, `PWA v1.3.0`,
  `precache 41 entries`). The only warning was a pre-existing, unrelated
  `inlineDynamicImports option is deprecated` notice from the PWA plugin's SW build.

## Files changed

- `src/lib/queryKeys.js` (modified)
- `src/data/clients.js` (new)
- `src/data/appointments.js` (modified)
- `src/components/AppointmentCard.jsx` (modified)
- `src/features/home/MemberHomeScreen.jsx` (modified)

## Self-review

- `AppointmentCard` refactor preserved `sx`, `statusLabel`, and `titleAccess` — confirmed
  by reading the final file; nothing in that logic changed shape.
- `MemberHomeScreen` updated to pass `person={appointment.pro}` — confirmed.
- No other consumer of `AppointmentCard` exists — confirmed by grep above.
- Nothing added beyond what the brief specifies — all code was transcribed verbatim
  from the brief's Steps 1-5.
- `git status --porcelain` before staging showed one unrelated modified file,
  `.superpowers/sdd/progress.md` (controller bookkeeping), which was deliberately left
  unstaged and out of the commit, per the task's staging instructions.

## Concerns

None. The refactor is mechanical and the verbatim transcription matched the brief
exactly; lint and build both pass clean.
