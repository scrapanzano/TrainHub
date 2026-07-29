# Task 12 report: Weekly availability

## What was implemented

1. `src/data/availability.js` (new) — `fetchAvailability(proId)`, `addAvailability({ id, proId, weekday, startsAt, endsAt })`, `deleteAvailability({ availabilityId })`. Transcribed verbatim from the brief.
2. `src/lib/mutationKeys.js` — added `addAvailability: ['addAvailability']` and `deleteAvailability: ['deleteAvailability']`.
3. `src/data/mutations.js` — imported `addAvailability`/`deleteAvailability` from `./availability.js`; registered both via `queryClient.setMutationDefaults`, each `onSettled` invalidating `queryPrefixes.availability`.
4. `src/features/calendar/AvailabilityScreen.jsx` (new) — the screen: `<h1>Availability</h1>` intro, cards grouped Monday-first (`DISPLAY_ORDER = [1,2,3,4,5,6,0]`) over the raw `weekday` (0 = Sunday, unchanged from storage), delete `IconButton` per slot with a descriptive `aria-label`, an "Add a slot" form (`<h2>`) with day select + two `type="time"` fields, client-side `endsAt <= startsAt` guard disabling submit and showing helper text, "Saved offline" messaging when `add.isPending && add.isPaused`.
5. `src/routes/index.jsx` — replaced the `calendar/availability` placeholder with a `lazy` import of `AvailabilityScreen.jsx`, keeping it listed before `calendar/:appointmentId` per the existing comment.

## One deviation from the brief (required to pass lint)

The brief's `AvailabilityScreen.jsx` imports `addAvailability, deleteAvailability, fetchAvailability` from `../../data/availability.js`, but the screen only ever calls these mutations through `useMutation({ mutationKey: ... })` (relying on the registered defaults in `mutations.js` for `mutationFn`) — it never calls `addAvailability`/`deleteAvailability` directly. ESLint's `no-unused-vars` failed on both. Per the task instructions ("remove the unused thing rather than suppressing, and report it"), I removed `addAvailability` and `deleteAvailability` from that import, keeping only `fetchAvailability` (which the screen does use, in `queryFn: () => fetchAvailability(user.id)`). No `eslint-disable` was used. This matches the pattern the task brief itself calls out as having happened in an earlier task this phase.

Nothing else was changed from the brief's code.

## Columns checked against `supabase/schema.sql`

`availability` (lines 119-128):
```
id          uuid primary key default gen_random_uuid(),
pro_id      uuid not null references profiles(id) on delete cascade,
weekday     int  not null check (weekday between 0 and 6),
starts_at   time not null,
ends_at     time not null,
check (ends_at > starts_at)
```
`fetchAvailability` selects `id, weekday, starts_at, ends_at` filtered by `pro_id` — all present. `addAvailability` writes `id, pro_id, weekday, starts_at, ends_at` — all present, and the two check constraints (`ends_at > starts_at`, `weekday between 0 and 6`) are the real guard; the screen's `invalidRange` check is only the pre-flight courtesy. `deleteAvailability` filters by `id` only.

## Commands run

- `npm run lint` — first run failed with 2 `no-unused-vars` errors (see deviation above); after removing the two unused imports, re-ran and it exited 0 with no output.
- `npm run build` — succeeded. Vite built `dist/`, `AvailabilityScreen-DyQBEuYw.js` (3.45 kB) emitted as its own chunk, `Add-BcUKD52F.js` and `DeleteOutlined-Br4vzSJz.js` icon chunks resolved cleanly, PWA service worker (`dist/sw.js`) generated afterward with no errors.

## Files changed (`git show --stat HEAD`)

```
src/data/availability.js                     |  50 +++++++
src/data/mutations.js                        |  15 +++
src/features/calendar/AvailabilityScreen.jsx | 190 +++++++++++++++++++++++++++
src/lib/mutationKeys.js                      |   2 +
src/routes/index.jsx                         |   7 +-
5 files changed, 263 insertions(+), 1 deletion(-)
```
Exactly the five files the brief names — verified with `git show --stat HEAD` before committing that only these were staged (`.superpowers/sdd/progress.md`, which was already modified in the working tree from prior tasks, was left unstaged).

Commit: `c66782d feat(pro): add weekly availability editor` on branch `phase-3-professional-side`. Conventional Commits format, no trailer.

## Self-review

- `crypto.randomUUID()` is generated inside the form's `onSubmit` handler (inside `add.mutate({...})` call), not during render — confirmed by reading the file back.
- Both `addAvailability` and `deleteAvailability` are registered in `src/data/mutations.js` via `setMutationDefaults`. Neither call site (`useMutation({ mutationKey: ... })`) passes `onSettled`; the only per-call option is `{ onSuccess }` passed as the second argument to `add.mutate(vars, { onSuccess })`, which composes rather than replaces (per-call `onSuccess` and the registered `onSettled` both fire).
- `weekday` stored value is untouched — Postgres' 0-is-Sunday convention is preserved in `fetchAvailability`, `addAvailability`, and the `DAY_NAMES` array (`DAY_NAMES[0] === 'Sunday'`). Only `DISPLAY_ORDER = [1,2,3,4,5,6,0]` reorders what's rendered, Monday-first; the raw number is never shown to the user, only the mapped day name.
- Every delete `IconButton` has `aria-label={`Remove ${DAY_NAMES[dayIndex]} ${hhmm(slot.starts_at)} to ${hhmm(slot.ends_at)}`}` — names the day and the exact time range it removes.
- Nothing was added beyond the brief. The only change from the brief's literal text is the import-list trim described above (removal, not addition), reported as required.

## Browser checks deferred to the human

Cannot exercise a browser or database from this environment. Per the brief's Step 5, the human should verify signed in as Coach Andrea:
- `/p/calendar/availability` shows the ten seeded slots grouped Monday to Friday, two per day (Postgres `weekday` 1-5 from `seed.sql`'s `generate_series(1, 5)`, displayed under the correct day names).
- Adding a Saturday slot creates a new Saturday card at the end of the list.
- Setting "To" earlier than "From" shows the red helper text and disables the "Add slot" button.
- Removing a slot removes just that row, and the day's card disappears entirely once its last slot is gone.
- Offline: submitting a slot while offline shows "Saved offline" on the button and an info `Alert`; reconnecting replays it into Postgres without a page reload (per the phase's offline round-trip acceptance item).
