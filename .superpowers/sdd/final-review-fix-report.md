# Phase 1 final whole-branch review — fixes

## What changed

### CRITICAL 1 — `src/features/auth/AuthProvider.jsx`
- Added `PROFILE_CACHE_KEY`, `readCachedProfile`, `writeCachedProfile`, `isOfflineError` helpers above the component.
- `.then` handler: on success, writes the profile to `localStorage` and sets state as before. On error, detects offline via `isOfflineError` (empty postgrest `code`, or `!navigator.onLine`) instead of relying on a `.catch` that postgrest-js never triggers for network failures, and falls back to the cached profile when offline, only surfacing an error when there is no cache to fall back to.
- `.catch` handler (floor for non-postgrest throws): also falls back to the cached profile before reporting an error.
- `signOut`: clears `PROFILE_CACHE_KEY` from `localStorage` before calling `supabase.auth.signOut()`, so a shared device doesn't leak the previous member's name/avatar into the next session.

### CRITICAL 2 — `src/lib/queryClient.js`
- Queries' `retry: 2` replaced with `retry: (failureCount) => navigator.onLine && failureCount < 2`, so a query fails fast (reaching `isError`) instead of pausing forever in `isPending` when the browser already knows it's offline. Mutations' `retry: 3` left untouched (Phase 2's outbox concern).

### IMPORTANT 3 — heading outline
- `src/components/TopHeader.jsx`: profile name `variant="h3"` → added `component="p"`.
- `src/features/home/MemberHomeScreen.jsx`: "Today" `h1` unchanged (page's only `<h1>`); "Workout" `variant="h1"` → added `component="h2"`; activity-count `variant="h3"` → added `component="span"`.
- `src/features/workout/SessionDetailScreen.jsx`: session name `variant="h2"` → added `component="h1"`; "Exercises" `h2` unchanged.
- `src/features/workout/WorkoutPlanScreen.jsx`: plan name `variant="h2"` → added `component="h3"`; "Sessions" `h2` unchanged.
- `src/features/workout/ExerciseDetailScreen.jsx`: no changes needed (already correct per spec).

### FIX NOW
1. `src/components/ScreenState.jsx` `ErrorState`: `typeof navigator !== 'undefined' && navigator.onLine === false` → `!navigator.onLine`.
2. `src/features/auth/ResetPasswordScreen.jsx`: removed `setPhase('done')` (dead branch), kept the immediate `navigate('/m', { replace: true })`, updated the phase-list comment to drop `'done'`.
3. `src/features/workout/WorkoutPlanScreen.jsx`: added `aria-hidden` to the `Typography` duplicating the `LinearProgress` `aria-label`.
4. `src/features/workout/WorkoutPlanScreen.jsx`: `subtitle = [plan.goal, plan.level].filter(Boolean).join(' - ')` computed once; the `Typography` now renders only when `subtitle` is non-empty.
5. Dead code removed:
   - `src/features/workout/status.js`: `SESSION_STATUS` no longer exported (kept as internal `const`, used only by `sessionStatusOf`). Confirmed no other file imports it.
   - `src/features/workout/SessionDetailScreen.jsx` and `ExerciseDetailScreen.jsx`: removed the unreachable `if (!data) return <LoadingState />` guard (queries use `.single()`, which errors rather than resolving null). `LoadingState` import kept — still used by each file's `isPending` branch.
   - `src/components/ScreenState.jsx`: `EmptyState`'s unused `action` prop and its render removed. Verified via `grep -rn "EmptyState" src/` that no call site (`MemberHomeScreen.jsx` x2, `WorkoutPlanScreen.jsx` x2, `SessionDetailScreen.jsx` x1) passes `action`.

## Verification (verbatim)

**`npm run lint`**
```
> trainhub@0.0.0 lint
> eslint .
```
(exit 0, no findings)

**`npm run build`**
```
✓ 1104 modules transformed.
... (client + sw builds succeed)
PWA v1.3.0
mode      injectManifest
format:   es
precache  28 entries (944.89 KiB)
files generated
  dist/sw.js
✓ built in 37ms
```
(exit 0)

**`node src/lib/format.selfcheck.js`**
```
format: OK
```

**`node src/features/workout/status.selfcheck.js`**
```
workout status: OK
```

## Offline cold-start trace

Scenario: a member signed in while online, visited an exercise detail screen (so `queryKeys.sessionExercise(id)` and the profile are both cached), then went fully offline and cold-started the app.

1. **Browser loads the app shell.** The service worker (registered via `registerSW({ immediate: true })` in `main.jsx`, injectManifest strategy) serves `index.html`, JS/CSS bundles and the Inter latin font subset straight from the precache — no network needed, so the shell paints even fully offline.
2. **`AuthProvider` mounts.** `supabase.auth.getSession()` resolves from `localStorage` (Supabase's own session persistence), so `sessionReady` becomes `true` and `session`/`userId` are known without any network call.
3. **Profile fetch fires and fails fast.** The `profiles` select rejects immediately with `TypeError: Failed to fetch` caught internally by postgrest-js, resolving `{data: null, error: {code: '', ...}}`. `isOfflineError` sees `!navigator.onLine` (or the empty `code`) and is `true`. `readCachedProfile(userId)` finds the profile written to `PROFILE_CACHE_KEY` during the earlier online session and matches on `id`. `profileState` becomes `{forUserId: userId, data: cachedProfile, error: null}`.
4. **`AppLayout` role guard.** `loading` is `false` (session known, profile settled for this user), `profile` is the cached object (truthy), so the "profile unavailable"/offline block is skipped entirely. `profile.role` matches `requiredRole` (`'member'`), so the member shell renders: `TopHeader` (greeting + cached name/avatar), `Outlet`, `BottomNav`.
5. **`PersistQueryClientProvider`** restores the TanStack Query cache from IndexedDB (`idb-keyval` via `createAsyncStoragePersister`) within `CACHE_MAX_AGE` (one week), so every previously-fetched query key is available in memory before any screen queries.
6. **Per-screen behaviour**, all screens under the now-rendered shell:
   - **`MemberHomeScreen`**: `appointmentsOnDay(memberId, todayISO())` is a *fresh* key (today's date wasn't cached from the earlier session) — the query fires, fails immediately (`retry` returns `false` because `!navigator.onLine`), reaches `isError` with `data === undefined`, and renders `ErrorState` ("You are offline", with Retry) inside the Today section. `activePlan(memberId)` — if visited before — is cached and renders normally from the persisted cache with no spinner and no error.
   - **`WorkoutPlanScreen`**: `activePlan(user.id)` — if it was fetched in the earlier session — serves straight from the persisted cache: plan card, progress bar and session list render with real data, no loading/error state.
   - **`SessionDetailScreen`**: same pattern — if that particular `session(sessionId)` was visited before, it renders from cache; if not, the query fails fast and `ErrorState` (offline copy, Retry) shows in place of the card list.
   - **`ExerciseDetailScreen`**: the specific exercise the member viewed before going offline is cached (`sessionExercise(id)`), so it renders in full — image, facts, instructions, trainer's note — straight from the persisted cache, indistinguishable from being online.
   - Any query key never fetched before this cold start (uncached) fails fast and shows `ErrorState`'s "You are offline" / Retry copy instead of spinning forever, because `retry` no longer pauses indefinitely on `networkMode: 'offlineFirst'`.

## No-cached-profile case (first-ever launch, offline)

If this is the very first launch and the member has never been online (no session in `localStorage`, no cached profile): `getSession()` resolves with `session: null`, `sessionReady` is `true`, `userId` is `null`, so `profileState` is set to `{forUserId: null, data: null, error: null}` and `loading` is `false` with no `user`. `AppLayout` never reaches the profile branch at all — `if (!user) return <Navigate to="/login" replace .../>`. The login screen itself would then need network to authenticate; that's outside this fix's scope (no session exists to resolve offline).

If instead there **is** a persisted session (previously signed in) but no profile was ever cached (e.g. profile write failed, cache was cleared, or this is a different device that only ever got as far as `getSession()`), the fetch fails offline, `readCachedProfile` returns `null` (no match), so `profileState.error` is set to `{...error, offline: true}`. `AppLayout`'s `if (!profile)` branch renders, `offline = profileError?.offline === true` is `true`, and the member sees **"You are offline" with a Retry button** (`window.location.reload()`) — never the "Profile unavailable"/Sign out branch, which is now reachable only for a genuine denial/missing-row error encountered while online.
