# Offline cold-start latency fix

## Problem

Every offline cold start showed a blank white screen for about seven seconds
before anything rendered. Two independent causes stacked:

1. `postgrest-js` retries a failed GET three times internally (1s + 2s + 4s
   backoff, `DEFAULT_MAX_RETRIES = 3`), inside the query function itself, so
   the TanStack Query `retry` predicate in `src/lib/queryClient.js` cannot
   suppress it — that predicate only governs whether *react-query* re-issues
   the whole query, not the retry loop already running inside the promise it
   is awaiting.
2. `src/layouts/AppLayout.jsx` rendered `null` while `loading` was true, so
   those seconds (and the normal, imperceptible online loading gap) were
   blank instead of showing anything.

## Proof `.retry()` exists and is chainable

From the installed `node_modules/@supabase/postgrest-js/dist/index.cjs`:

```
252	/**
...
256	* Configure retry behavior for this request.
...
273	retry(enabled) {
274		this.retryEnabled = enabled;
275		return this;
276	}
277	then(onfulfilled, onrejected) {
...
307				if (_this.retryEnabled && attemptCount < DEFAULT_MAX_RETRIES) {
...
315				if (shouldRetry(_this.method, res$1.status, attemptCount, _this.retryEnabled)) {
```

`.retry(enabled)` sets `this.retryEnabled` and returns `this`, so it chains
like any other builder method (`.eq()`, `.single()`, `.order()`, …). The flag
it sets is read inside `then()` — the method that actually drives the fetch
loop — both to decide whether to retry a thrown network error (line 307) and
whether to retry a retryable HTTP status via `shouldRetry()` (line 315). Since
`then()` only runs when the chain is finally awaited/`.then()`-ed, `.retry()`
just has to appear anywhere earlier in the chain, which is where it was
placed in every call site below.

## Changes

1. **`src/features/auth/AuthProvider.jsx`** — the profile fetch
   (`.from('profiles').select(...).eq(...).single()`) now ends with
   `.retry(navigator.onLine)`, with the rationale comment placed directly
   above the call.

2. **`src/data/workouts.js`** — one file-level comment above the imports'
   trailing blank line, and `.retry(navigator.onLine)` appended to all four
   reads: `fetchActivePlan`'s plan query, `fetchActivePlan`'s sessions query,
   `fetchSession`, and `fetchSessionExercise`.

   Note: the task described this file as having "three queries (fetchActivePlan
   has two)", i.e. `fetchActivePlan` (2) + `fetchSession` (1). The file also
   contains a fourth read, `fetchSessionExercise`, of the exact same shape
   (`select().eq().single()`) and in the exact same failure class — it renders
   the exercise-detail screen on a cold start exactly like the other three. Per
   "apply to every read in these three files," and to avoid leaving a sibling
   caller with the same bug unfixed, `.retry(navigator.onLine)` was added there
   too. Flagging this deviation explicitly since the task's count did not
   mention it.

3. **`src/data/appointments.js`** — one file-level comment, and
   `.retry(navigator.onLine)` appended to `fetchAppointmentsOnDay`'s query.

4. **`src/layouts/AppLayout.jsx`** — imported `LoadingState` from
   `../components/ScreenState.jsx` (added to the existing `BottomNav`/
   `TopHeader`/`useAuth` import block, alphabetically ordered to match the
   file's existing style) and changed `if (loading) return null` to
   `if (loading) return <LoadingState />`, with the comment updated to explain
   why a spinner and not `null`. The three branches after it (`!user` redirect,
   `!profile` error/offline panel, `profile.role !== requiredRole` redirect,
   and the final shell render) are untouched.

`src/lib/queryClient.js` was not touched — its `retry` predicate still governs
react-query's own retry-the-whole-query behaviour, a separate layer from
postgrest's internal retry loop.

## Verification

```
$ npm run lint
> trainhub@0.0.0 lint
> eslint .
(no output, exit 0)

$ npm run build
> trainhub@0.0.0 build
> vite build
✓ 1104 modules transformed, built in 318ms
PWA v1.3.0 — service worker built, injectManifest, 28 precache entries (944.99 KiB)
(exit 0)

$ node src/lib/format.selfcheck.js
format: OK

$ node src/features/workout/status.selfcheck.js
workout status: OK
```

## Behavioural confirmation

- (a) Every read in the three specified files (plus `fetchSessionExercise`,
  see note above) now carries `.retry(navigator.onLine)`, chained after the
  existing builder calls and before the implicit `await`/`.then()`. The chain
  still compiles (`npm run build` succeeded) and lints clean.
- (b) Online behaviour is unchanged: `navigator.onLine` is `true` while
  connected, so `.retry(true)` preserves postgrest's default retry-on-503/520
  behaviour for transient errors. Nothing about the retry predicate in
  `src/lib/queryClient.js` or the backoff timings was touched.
- (c) `AppLayout` now renders `<LoadingState />` (a centred MUI
  `CircularProgress` with `role="status"`) instead of `null` while `loading`
  is true. The four branches after it — `!user` → `<Navigate to="/login" />`,
  `!profile` → the offline/error panel, `profile.role !== requiredRole` →
  role redirect, and the final shell (`TopHeader`/`Outlet`/`BottomNav`) — are
  byte-for-byte unchanged.

## Offline cold start: before vs. after

**Before:** blank white screen for ~7s (3 retries × 1s/2s/4s backoff inside
postgrest, compounded across the profile fetch and whichever screen query is
in flight), then either the offline error panel or cached content appears.

**After:** `navigator.onLine` is `false` offline, so `.retry(false)` makes
every read fail on the first attempt — no backoff loop. The `AppLayout`
loading branch is also no longer `null`, so a spinner is visible immediately
on mount. Net effect: a spinner appears near-instantly (within the normal
`getSession()`/local-storage resolution time, well under a second), followed
by either the cached profile/shell or the "You are offline" panel from
`AppLayout`'s `!profile` branch — no multi-second blank screen.
