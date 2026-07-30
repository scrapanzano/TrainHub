# Task 9 report: Settings, password change and logout

## What was implemented

- `src/features/profile/SettingsScreen.jsx` — created verbatim from the brief.
  A single screen for both roles: a password-change form
  (`supabase.auth.updateUser({ password })`, client-side mismatch check only,
  server error message surfaced as-is, no invented rules) and a "Sign out"
  button wired to `useAuth().signOut`.
- `src/routes/index.jsx` — replaced the two `screen('Settings')` placeholders
  at `/m/profile/settings` and `/p/profile/settings` with the same lazy import
  of `SettingsScreen.jsx`, matching the existing lazy-route style used
  throughout the file.

## Investigation before writing code

Per the "Before You Begin" instruction, I checked whether the brief's
verbatim code (which only calls `signOut`, doing nothing to the persisted
TanStack Query cache) contradicts the "logout must leave no usable state
behind" concern raised in my task framing.

- `src/features/auth/AuthProvider.jsx`: `signOut` already removes the cached
  profile (`localStorage` key `trainhub-profile`) *before* calling
  `supabase.auth.signOut()`, so a failed network call still ends the local
  session without a stale profile surviving it. The brief's instruction not
  to reimplement this is correct — there is nothing left to add here.
- `src/lib/queryKeys.js`: every query key that could carry one user's private
  data is parameterized by that user's own id or by an opaque resource id
  (`memberId`, `proId`, `clientId`, `appointmentId`, `sessionId`, `threadId`,
  ...). The only unparameterized keys are `exerciseCatalogue()` and
  `professionals()`, both shared, non-sensitive reference data. Because
  Daniel and Andrea have different ids, Andrea signing in on the same device
  cannot have Daniel's cached queries served to her screens — her queries use
  different keys entirely, and RLS is the actual boundary regardless. Stale
  entries for the previous user sit inert in IndexedDB until `gcTime` (one
  week) evicts them; they are never read by the incoming user's screens.
  I judged this not to contradict the brief and did not add a
  `queryClient.clear()` call the brief does not specify — doing so would
  also have been a bigger diff than the brief asked for, and Task 9's own
  interface list names only `useAuth().signOut` and
  `supabase.auth.updateUser`.
- No new mutation is registered in `src/data/mutations.js` /
  `src/lib/mutationKeys.js`: the password change calls
  `supabase.auth.updateUser` directly (a security path against
  `auth.users`, not a table write), not through `useMutation`, so the
  mutation-registration rule does not apply — this matches the brief's
  interface list, which does not mention a new mutation key.
- Confirmed `@mui/icons-material/Logout` exists in
  `node_modules/@mui/icons-material/` (`Logout.js`/`.mjs` present) before
  using it.
- Confirmed heading levels match the sibling `ProfileScreen.jsx`: one
  `variant="h1"` per screen ("Settings"), `variant="h3"` for the card title
  ("Change password"). No `<h2>` was needed — there is one card plus a
  divider and a button, no intermediate section.

## Verified

`npm run lint` (exit 0, no output):
```
> trainhub@0.0.0 lint
> eslint .
```

`npm run build` (succeeded, PWA precache generated, service worker built):
```
> trainhub@0.0.0 build
> vite build
...
✓ built in 702ms
PWA v1.3.0
...
✓ built in 67ms
PWA v1.3.0
mode      injectManifest
format:   es
precache  83 entries (1138.48 KiB)
files generated
  dist/sw.js
```

All eight `*.selfcheck.js` scripts still pass (shared code was not touched,
run anyway per the phase acceptance checklist):
```
format: OK
resolveTokens: OK (22 tokens)
timer: OK
workout status: OK
summary: OK
subscription.selfcheck OK
month.selfcheck OK
progress.selfcheck OK
```

**Not run — needs a human with database credentials / a browser**: the
brief's manual browser check (mismatch message on two different passwords,
sign out from `/m/profile/settings`, land on `/login`, sign in as Coach
Andrea). I did not fake this; it is unverified. The rest of the Phase 4A
acceptance checklist (chat round trip, offline round trips, `verify.sql`,
etc.) is also outside what this task or agent can execute.

## Files changed

- `src/features/profile/SettingsScreen.jsx` (new)
- `src/routes/index.jsx` (both `profile/settings` routes rewired to the lazy
  import)

## Self-review findings

- Code matches the brief verbatim; no deviations.
- `screen()` placeholder helper in `src/routes/index.jsx` remains used by
  `/m/profile/badge` and `/p/scan` (Phase 4B), so removing the two
  `profile/settings` placeholder entries left no dead code.
- Git status showed pre-existing unstaged changes under `.superpowers/sdd/*`
  (progress ledger and prior task reports) that were already modified in the
  working tree before this task started — not something I touched. Per the
  working agreement these are scratch bookkeeping and must not enter a
  feature commit; only `src/features/profile/SettingsScreen.jsx` and
  `src/routes/index.jsx` were staged and committed.
- No `eslint-disable` used. No new runtime dependency. No CSS files or colour
  literals — styling is MUI + theme only, all colours via `color="error"` /
  `color="text.secondary"` semantic props.
- Password field values are cleared from state after a successful change
  (`setPassword(''); setConfirm('')`), so the plaintext does not linger in
  memory / React state longer than needed.

## Issues or concerns

None found. This closes the last gap named in the working agreement: there
is now a logout control in the UI, and the "clear `localStorage` by hand to
switch demo accounts" workaround is no longer needed. This was the final
task of Phase 4A; only the whole-branch review and the human-run acceptance
checklist (browser checks, `supabase/verify.sql`, patch 007) remain.

## Review fixes (round 2)

Three findings came back from review. Fixed all three.

### Finding 1 (Important) — double submit on the password form

`onSubmit`'s early-return guard (`if (mismatch || password === '') return`)
never checked `status.phase`, and neither `TextField` was disabled while
`status.phase === 'saving'`. Typing a character mid-save reset `status` back
to `idle` via the "New password" field's `onChange`, which re-enabled the
submit button (`disabled={... || status.phase === 'saving'}` was now false
again) and let a second `supabase.auth.updateUser` fire concurrently.

Fixed both halves in `src/features/profile/SettingsScreen.jsx`:
- `onSubmit`'s guard now also bails on `status.phase === 'saving'`.
- Both the "New password" and "Confirm new password" `TextField`s now carry
  `disabled={status.phase === 'saving'}`, so neither can be edited (and so
  neither `onChange` can reset `status` back to `idle`) while a save is in
  flight.

The existing "clear a stale result when the user starts over" comment and
behaviour on the idle/done/error phases is unchanged.

### Finding 2 (Important) — the persisted query cache survives logout

`AuthProvider.signOut` cleared only the `trainhub-profile` `localStorage`
key. Because `AppLayout` navigates client-side on sign-out with no page
reload, the in-memory `QueryClient` and its IndexedDB mirror
(`idb-keyval`, key `trainhub-query-cache`, written by the
`createAsyncStoragePersister` in `src/lib/queryClient.js`) both survived
sign-out untouched — the outgoing user's chat messages, nutrition plan,
body metrics, appointments and session logs stayed readable in cleartext
IndexedDB via DevTools for up to the one-week `gcTime`.

Fixed at the root, in `signOut` itself (`src/features/auth/AuthProvider.jsx`),
so both callers benefit — `SettingsScreen`'s "Sign out" button and
`AppLayout`'s profile-failure "Sign out" button both call this same
`useAuth().signOut`; grepped for `signOut` across `src/` to confirm there is
no other call site.

- Imported `persister, queryClient` from `../../lib/queryClient.js` into
  `AuthProvider.jsx`. Checked for an import cycle first: `queryClient.js`
  only imports `@tanstack/react-query`, `@tanstack/query-async-storage-persister`
  and `idb-keyval` — nothing under `src/features/`, so no cycle.
- Added `queryClient.clear()` and `await persister.removeClient()` to the
  same unconditional block that already clears the profile cache, still
  *before* `await supabase.auth.signOut()` — so the clear does not depend on
  the network call succeeding, matching the existing pattern's own reasoning.
  `persister.removeClient()` (from `@tanstack/query-async-storage-persister`,
  verified by reading its source in `node_modules`) calls
  `storage.removeItem(key)` directly, i.e. `idb-keyval`'s `del()` on
  `trainhub-query-cache` — this deletes the IndexedDB entry immediately
  instead of waiting for the persist subscription's 1s throttle to notice the
  now-empty client and rewrite it. Wrapped the `removeClient()` call in its
  own `try/catch` (best-effort — the in-memory cache is already cleared
  either way, so a storage failure here must not block sign-out).
- Left a comment on the new code stating explicitly that this also discards
  any paused mutations still queued for the outgoing user, and that on a
  deliberate sign-out this is the correct trade-off, not something to "fix"
  back later.

### Finding 3 (Minor) — inconsistent status reset

The "Confirm new password" field's `onChange` set `confirm` but never reset
`status`, so editing only that field after a done/error result left a stale
`Alert` above a form being re-filled. Made it match the "New password"
field: `onChange` now also resets `status` to idle when `status.phase !==
'idle'`, with a short comment pointing at the sibling field's comment for the
rationale.

### Verified

`npm run lint` (exit 0, no output):
```
> trainhub@0.0.0 lint
> eslint .
```

`npm run build` (succeeded, PWA precache generated, service worker built):
```
> trainhub@0.0.0 build
> vite build
...
✓ built in 648ms
PWA v1.3.0
...
✓ built in 106ms
PWA v1.3.0
mode      injectManifest
format:   es
precache  83 entries (1138.65 KiB)
files generated
  dist/sw.js
```

All eight `*.selfcheck.js` scripts (run because this touches shared auth
code):
```
format: OK
resolveTokens: OK (22 tokens)
timer: OK
workout status: OK
summary: OK
subscription.selfcheck OK
month.selfcheck OK
progress.selfcheck OK
```

### Files changed (this round)

- `src/features/profile/SettingsScreen.jsx` — guard + disabled state on both
  password fields (Finding 1), consistent `onChange` reset on the confirm
  field (Finding 3).
- `src/features/auth/AuthProvider.jsx` — `signOut` now clears the TanStack
  Query cache and its IndexedDB mirror (Finding 2).

Only these two files were staged. `.superpowers/sdd/*` scratch bookkeeping
(pre-existing unstaged changes from before this round, plus this report
edit) was left out of the commit per the working agreement.

### Anything found that the findings did not mention

Nothing beyond what the three findings already named. Confirmed by grep that
`signOut` has exactly two call sites in the UI (`SettingsScreen.jsx`,
`AppLayout.jsx`) and one definition (`AuthProvider.jsx`) — the Finding 2 fix
in the provider covers both without touching either call site.
