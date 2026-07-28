# Task 5 Report: Login screen

## Files created

- `src/features/auth/LoginScreen.jsx` — new. Transcribed verbatim from the brief's Step 2 code block (100 lines, including all comments).

## Files modified

- `src/layouts/AppLayout.jsx`
  - Import line: added `useLocation` to the `react-router` import.
  - Added `const location = useLocation()` immediately after the existing `useAuth()` call, above the `if (loading)` early return (hooks can't be conditional).
  - Replaced `if (!user) return <Navigate to="/login" replace />` with the version carrying `state={{ from: location.pathname }}`, plus the brief's explanatory comment.
  - No other lines touched — the `if (loading)`, `!profile`, `role !== requiredRole`, and shell-render branches are untouched.

- `src/routes/index.jsx`
  - Added `import LoginScreen from '../features/auth/LoginScreen.jsx'` directly below the `Placeholder` import.
  - Replaced `{ path: '/login', ...screen('Login') }` with `{ path: '/login', element: <LoginScreen /> }`.
  - No other route entries touched.

## Pre-edit verification

Read all three target files in full before editing, plus `src/lib/supabase.js` and `src/layouts/PublicLayout.jsx` for context. Confirmed:
- `useAuth()` signature matches what the brief and `LoginScreen.jsx` assume (`{ session, user, profile, profileError, loading, signOut }`).
- `PublicLayout.jsx` already renders a centred `BrandLogo` above the `<Outlet />`, so the "centred logo" part of the Figma spec (`01 - Login.png`) is satisfied by the layout wrapper, not by `LoginScreen.jsx` itself — no duplicate logo was needed inside the new screen.
- `supabase.js` exports the singleton `supabase` client as expected by the `signInWithPassword` call.

## Lint

`npm run lint` → exit 0, no output (clean). Ran after all edits, before staging/commit.

## Commit

```
f3555effc8a4e0f018e1a0e9ecee60e2d6011683 feat: add login screen with attempted-route resume
```

Author: Davide <d.leone001@studenti.unibs.it> (single author, no `Co-Authored-By` trailer — verified via `git show`).

Stat:
```
 src/features/auth/LoginScreen.jsx | 100 ++++++++++++++++++++++++++++++++++++++
 src/layouts/AppLayout.jsx         |   8 ++-
 src/routes/index.jsx              |   3 +-
 3 files changed, 108 insertions(+), 3 deletions(-)
```

All three files landed together in one commit, as required. The pre-existing unstaged `README.md` modification was left untouched (confirmed via `git status` before commit — only the three task files were staged).

## Step 4 (browser verification)

**Deferred to the human**, per instruction. No dev server was started; the table of manual checks (empty-email required prompt, wrong-password alert text, successful login to `/m`, attempted-route resume to `/m/workout`, already-signed-in redirect from `/login`, `/p` login for the professional role) was not exercised. This needs a human with a browser and access to the Supabase test accounts (`daniel@trainhub.dev`, `andrea@trainhub.dev`) to confirm.

## Self-review

What was checked:
- Diffed the written `LoginScreen.jsx` content against the brief's code block mentally while writing — comments, prop names, and logic transcribed as-is, no rewording.
- Confirmed the `!user` redirect change in `AppLayout.jsx` sits above the `if (loading)` return and next to the existing `useAuth()` call, satisfying the "hooks can't be conditional" constraint.
- Confirmed no `setSubmitting(false)` was added on the success path in the submit handler.
- Confirmed the Supabase error message is passed through unchanged (`setError(signInError.message)`), no wording changes.
- Confirmed no new dependencies were imported (only `@mui/material`, `react-router`, `react`, and the two existing local modules `supabase.js` and `useAuth.js`).
- Confirmed no CSS files or inline color literals were added — styling uses only `sx` props referencing the theme (`primary.main`, `text.secondary`).
- Ran `git status` after `git add` to confirm only the three intended files were staged before committing.

Nothing was changed after the initial write — the diff matched the brief on the first pass, and lint passed cleanly without requiring fixes.

## Fix: login dead-end on profile failure

**Finding (Critical):** `LoginScreen` gated its redirect on `user && profile`. `AuthProvider` records a failed profile fetch (RLS denial, missing row, offline) as a *settled* state — `loading` goes `false` but `profile` stays `null` forever. With the old condition, `Navigate` never fired, the screen never unmounted, and `setSubmitting(false)` (deliberately skipped on the success path) never ran either — the button was stuck on "Logging in…" indefinitely, no error shown, no way out.

**Fix applied** to `src/features/auth/LoginScreen.jsx`: changed the redirect guard from `user && profile` to `user && !loading`, and the target-role lookup from `HOME_FOR[profile.role]` to `HOME_FOR[profile?.role]`. Redirect now fires as soon as auth has settled for a signed-in user, whether or not the profile arrived. A null profile resolves `HOME_FOR[undefined]` to `undefined`, so the `?? '/m'` fallback sends the user to `/m`, where `AppLayout` already owns the "Profile unavailable" / "You are offline" screen with Retry and Sign out. No other lines touched; no new state, no error banner added here, `AuthProvider`/`AppLayout` untouched.

### Lint

`npm run lint` → exit 0, no output (clean).

### Four-case trace (re-read file after edit)

- **(a) Signed out** — `user` is `null` (or session unresolved with `loading` true) → `user && !loading` is false on both counts → falls through to the form. Correct: shows the login form, button enabled once `loading` is false.
- **(b) Signed in, profile arrived** — `user` truthy, `loading` false, `profile` truthy → redirects to `location.state?.from ?? HOME_FOR[profile.role] ?? '/m'`, i.e. the intended role home (or resumed route). Correct, unchanged behavior from before.
- **(c) Signed in, profile fetch failed** — `user` truthy, `loading` false (AuthProvider settles even on error), `profile` is `null` → `user && !loading` is true → redirects via `HOME_FOR[profile?.role]` = `HOME_FOR[undefined]` = `undefined` → falls back to `'/m'`. `AppLayout` at `/m` sees `!profile` and renders its offline/"Profile unavailable" screen with Retry or Sign out. This is the dead-end that's now fixed: the button no longer sticks on "Logging in…" — the screen unmounts and hands off.
- **(d) Mid-submit, before session arrives** — `submitting` is true, but `user` is still `null` (session hasn't landed yet) → `user && !loading` is false → stays on the form, button shows "Logging in…" and is disabled via `submitting || loading` until the session (and thus `user`) arrives, at which point case (b) or (c) takes over and unmounts the screen. No path leaves the button permanently disabled.

### Commit

```
1148677 fix(auth): redirect from login once auth settles, not just on profile arrival
```

Single file changed (`src/features/auth/LoginScreen.jsx`, 8 insertions, 2 deletions), no `Co-Authored-By` trailer, single author (Davide).
