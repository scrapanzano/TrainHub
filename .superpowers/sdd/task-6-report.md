# Task 6 report: the member's trainer section

## What I implemented

Exactly the brief, verbatim:

- `src/data/profile.js` (new) — `fetchProfessionals()` (read, `.retry(navigator.onLine)`) and
  `chooseProfessional({ memberId, proId })` (write, no retry), matching the brief's code exactly.
- `src/data/mutations.js` — added `import { chooseProfessional } from './profile.js'` and registered
  `mutationKeys.chooseProfessional` via `setMutationDefaults`, invalidating `queryPrefixes.chat` on
  settle, with the brief's comment explaining why the member's own profile (held by `AuthProvider`
  outside the query cache) is not refreshed by this invalidation.
- `src/features/trainer/MyTrainerScreen.jsx` (new) — `/m/trainer`. Redirects to `/m/trainer/browse`
  when `profile.assigned_pro_id` is unset; otherwise fetches the professionals list (reused, not a
  second read) and shows the assigned pro's avatar/name/bio plus Chat and View Appointments cards.
- `src/features/trainer/BrowseTrainersScreen.jsx` (new) — `/m/trainer/browse`. Search box, specialty
  filter chips (`all` / `personal_trainer` / `nutritionist`, `both` matches either), a banner when no
  professional is assigned yet, and a card per professional with an Add/Check icon button that calls
  `chooseProfessional` and reloads to `/m/trainer` on success (profile lives outside the query cache,
  so a hard navigation is the only way to pick up the new `assigned_pro_id`).
- `src/routes/index.jsx` — replaced the `trainer` and `trainer/browse` placeholder entries with lazy
  routes to the two new screens, in the exact style of the other converted `/m/...` routes.
  `trainer/appointments` was left as a placeholder — out of scope for this task.

`mutationKeys.chooseProfessional` and `queryKeys.professionals()` / `queryPrefixes.professionals`
were already present from Task 1, confirmed before writing, no duplicates added.

All six MUI icons used (`ChatBubbleOutlineOutlined`, `CalendarMonth`, `ChevronRight`, `Search`, `Add`,
`Check`) were confirmed to exist under `node_modules/@mui/icons-material/` before import.

## Verified

`npm run lint`:
```
> trainhub@0.0.0 lint
> eslint .
```
Exit 0, no output — clean.

`npm run build`:
```
> trainhub@0.0.0 build
> vite build
...
✓ built in 619ms
...
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
...
✓ built in 58ms
PWA v1.3.0
mode      injectManifest
format:   es
precache  73 entries (1122.18 KiB)
files generated
  dist/sw.js
```
Build succeeded (both the client build and the service worker build). The
`inlineDynamicImports option is deprecated` warning is a pre-existing Vite/PWA-plugin
notice unrelated to this change.

`MyTrainerScreen-*.js` (1.86 kB) and `BrowseTrainersScreen-*.js` (3.17 kB) both appear as their own
chunks in the build output, confirming the lazy routes code-split correctly.

**Not run — needs a human with database credentials**: the browser check in the brief (sign in as
Daniel, confirm `/m/trainer` names Coach Andrea; clear `assigned_pro_id` in the SQL editor, confirm
the redirect to browse and that picking Andrea returns to `/m/trainer` with her assigned; restore
`assigned_pro_id` afterwards). I did not touch the database.

## Files changed

- `src/data/profile.js` (new)
- `src/features/trainer/MyTrainerScreen.jsx` (new)
- `src/features/trainer/BrowseTrainersScreen.jsx` (new)
- `src/data/mutations.js` (modified — import + one `setMutationDefaults` block appended)
- `src/routes/index.jsx` (modified — two placeholder entries replaced with lazy routes)

Commit: `f0a868a feat(member): add the trainer section and professional picker` — only these five
paths staged; the pre-existing unstaged changes under `.superpowers/sdd/` (progress.md, task-3/4/5
reports, .gitignore) were left alone, as instructed.

## Self-review findings

- Checked the brief's code against the actual repo shape: `mutationKeys.chooseProfessional` and
  `queryKeys.professionals()` / `queryPrefixes.professionals` already existed (Task 1), so no
  duplicate keys were added.
- Checked no call site passes `onSettled` to `useMutation` — `BrowseTrainersScreen` only passes
  `mutationKey`, and the per-call `onSuccess` in `choose.mutate(vars, { onSuccess })` is the safe,
  additive mechanism the constraints describe, not a replacement of the registered handler.
- Checked the write (`chooseProfessional`) carries no `.retry(...)` and the read
  (`fetchProfessionals`) does — matches the offline-write-pauses / read-retries-when-online rule.
  Confirmed the read uses `.retry(navigator.onLine)` per the repo convention.
- Checked heading levels: one `<h1>` per screen (`Personal Trainer` on both), `variant="h2"
  component="p"` for the pro's name on `MyTrainerScreen` (visually a name, not a section heading —
  matches the brief exactly), `variant="h3"` for card/section titles. No stray extra `<h1>`s.
  The pro's name reading as an `h2` while visually looking like a person's name is a little unusual,
  but the brief specifies it verbatim and there is no other `h2` on the page to collide with.
- `window.location.assign('/m/trainer')` is a full reload by design (per the brief's own comment) —
  confirmed this is the documented, deliberate workaround for `AuthProvider` holding profile outside
  the query cache, not an oversight.
- No new dependencies, no CSS files, no colour literals — all styling through `palette.*`/theme
  variants supplied by MUI components as in the brief's code.
- Nothing was added beyond the brief's four steps — no extra abstraction, no speculative props.

No `*.selfcheck.js` added: `profile.js` is two thin Supabase CRUD wrappers with no pure branching
logic. The specialty filter's `both`-matches-either logic lives inline in
`BrowseTrainersScreen.jsx` as a two-line filter predicate, mirroring the same untested inline
filtering pattern already used elsewhere in this codebase (e.g. `ClientsScreen`) — judged not
"non-trivial pure logic" per the project's own bar.

## Issues or concerns

None found. Lint and build both pass; the implementation matches the brief verbatim. The one
required manual step — the Supabase browser/SQL check — is explicitly out of reach without database
credentials and is called out above rather than being faked.
