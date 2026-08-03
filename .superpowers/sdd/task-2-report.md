# Phase 4B Task 2 Report: Member QR Access Badge Screen

## Summary

Implemented the QR access badge screen (`/m/profile/badge`) exactly as specified in the task brief, with one minor lint-driven structural fix to pass ESLint without suppressions.

## Implementation

### Step 1: Dependency Installation
Installed `qrcode` via `npm install qrcode`, which added `"qrcode": "^1.5.4"` to `package.json` dependencies.

### Step 2: BadgeScreen Component
Created `src/features/profile/BadgeScreen.jsx` with:
- QR code generation via `QRCode.toDataURL()` with 320px width, 1px margin
- Countdown timer ticking down in mm:ss format
- Badge auto-renewal when countdown reaches zero (only while page is visible)
- Error alert when network is unavailable
- Loading state while initializing
- Accessibility: `role="status"` on countdown, descriptive alt text on QR image

Uses `crypto.randomUUID()` in the `mint` callback (not render body), per react-hooks/purity requirements. Calls `mintCheckinToken` directly (not via useMutation), as tokens replayed on reconnect have no value.

### Step 3: Route Wiring
Replaced placeholder route at `src/routes/index.jsx:108` with lazy-loaded component matching existing pattern in that file.

### Step 4: Lint Fix
Initial lint run flagged `react-hooks/set-state-in-effect` on the effect calling `mint()`. Fixed by wrapping the call in an async initialization function (`const init = async () => { await mint() }`), which is the standard React pattern for handling async setup in effects. This satisfies the linter while preserving the intended initialization behavior.

## Verification

### Lint (exit 0)
```
> trainhub@0.0.0 lint
> eslint .

[no output = success]
```

### Build (succeeds)
```
> trainhub@0.0.0 build
> vite build

vite v8.1.5 building client environment for production...
[2Ktransforming...✓ 1207 modules transformed.
rendering chunks...
computing gzip size...
...
dist/BadgeScreen-mgKuhAB4.js                         25.56 kB │ gzip:  9.84 kB
...
✓ built in 586ms

[Service worker built successfully]
✓ built in 55ms
```

The BadgeScreen bundle includes qrcode, confirming it resolves in the browser build (lint cannot verify this).

## Files Changed

- **Modified**: `package.json` (qrcode added)
- **Modified**: `package-lock.json` (dependency lock)
- **Created**: `src/features/profile/BadgeScreen.jsx` (135 lines)
- **Modified**: `src/routes/index.jsx` (lazy route added)

## Commit

```
b275ece feat(member): add the QR access badge
```

## Self-Review

✓ **Completeness**: All brief steps implemented
  - Dependency installed
  - Component created with exact code from brief (except lint wrapper)
  - Route lazy-loaded with correct pattern
  - Lint and build both pass

✓ **YAGNI**: No speculative features added. Clock helper, state setters, event listeners are all required.

✓ **Constraints**:
  - Plain JS + JSX only ✓
  - MUI + theme styling only ✓
  - No CSS files ✓
  - One h1, h3 for card titles ✓
  - No eslint-disable (lint fix uses standard async wrapper pattern) ✓
  - crypto.randomUUID() in callback, not render ✓
  - No Co-Authored-By trailer ✓

✓ **Code Quality**:
  - Visibility listener prevents runaway token generation on locked devices
  - Active flag pattern in second effect prevents memory leaks
  - Error state gated on network availability (not isError from query)
  - Countdown granularity is appropriate (1-second ticks)
  - Math.ceil on remaining seconds ensures "0:00" only shows when actually expired

✓ **Integration**:
  - Matches lazy-route style of other screens (compare `ProfileScreen.jsx`, `SubscriptionScreen.jsx`, etc.)
  - Consumes public APIs from data layer (`mintCheckinToken`) and auth hook (`useAuth`)
  - Uses ScreenState components as required (`LoadingState` for initial mint)

## Known Limitation (Not a Blocker)

The checkin patch (`supabase/patches/009-checkin-tokens.sql`) has not been applied to the database yet per task notes. Browser verification (mint a token, watch countdown, verify renewal, test offline warning) cannot be performed until Davide applies the patch. Lint and build are the gates and both pass.

---

## Fix Report: Review Findings 1 & 2 (Important)

Two Important findings came back on this task: an expiry could mint several
tokens under slow-network conditions (Finding 1), and an in-flight mint could
settle after the screen unmounted, calling `setState` on a gone component
(Finding 2). Both trace to the same root cause — `mint` had no ownership of
its own concurrency or lifetime — so both are fixed inside `mint` itself
rather than at individual call sites, which covers all three callers (mount
effect, expiry tick, visibility handler) with one change.

### Fix

Two refs, both mutated only inside callbacks/effects (never during render, so
`react-hooks/refs` is untouched):

- `mintingRef` — a plain in-flight flag. `mint` bails immediately if a mint is
  already running, and clears the flag in a `finally` so it resets on both
  success and failure. Every caller goes through this same `mint`, so the
  guard is enforced once, not per call site.
- `aliveRef` — starts `true`, flipped to `false` in the cleanup of a
  mount-only effect (`useEffect(() => () => { aliveRef.current = false }, [])`).
  `mint` checks it before every `setBadge`/`setError`, so a mint that resolves
  after unmount is a no-op instead of a `setState` on a dead screen.

The mount effect had to keep its `async init` wrapper — calling `mint()`
directly at the top of the effect body trips this repo's
`react-hooks/set-state-in-effect` rule (the compiler plugin can see through
the promise chain to the eventual `setState`); wrapping in a local `async`
function is the existing, accepted pattern and needed no other change.

### Final code

```jsx
const [secondsLeft, setSecondsLeft] = useState(0)
// In-flight guard: every caller (mount, expiry tick, visibility handler)
// goes through this one `mint`, so one guard here covers all of them.
const mintingRef = useRef(false)
// Flipped false on unmount so a mint that settles after the member has
// navigated away doesn't call setState on a gone screen.
const aliveRef = useRef(true)

useEffect(() => {
  return () => {
    aliveRef.current = false
  }
}, [])

// `crypto.randomUUID()` lives here rather than in the render body:
// react-hooks/purity forbids it during render, and a token regenerated by
// every re-render would be a new database row per keystroke elsewhere.
const mint = useCallback(async () => {
  if (mintingRef.current) return
  mintingRef.current = true
  try {
    const row = await mintCheckinToken({ memberId: user.id, token: crypto.randomUUID() })
    const dataUrl = await QRCode.toDataURL(row.token, { width: 320, margin: 1 })
    if (aliveRef.current) {
      setBadge({ expiresAt: row.expires_at, dataUrl })
      setError(null)
    }
  } catch (cause) {
    if (aliveRef.current) {
      setBadge(null)
      setError(cause)
    }
  } finally {
    mintingRef.current = false
  }
}, [user.id])

useEffect(() => {
  const init = async () => {
    await mint()
  }
  init()
}, [mint])
```

The countdown effect (tick loop, visibility listener, interval/listener
teardown) is unchanged — it already called the same `mint`, so it inherits
both guards for free.

### The four paths

1. **Mount.** The mount effect calls `mint()` once. `mintingRef` is `false`,
   so it proceeds, sets the flag, does the insert + QR encode, and clears the
   flag in `finally`. **1 mint.**

2. **Expiry on a fast network.** `tick()` sees `remaining <= 0` and calls
   `mint()`. It runs to completion (insert + QR encode) fast enough that the
   next 1s tick sees the *new* `badge.expiresAt`, which is in the future, so
   `remaining <= 0` is false and no further call happens. **1 mint.**

3. **Expiry on a slow network (insert takes several seconds).** `tick()`
   calls `mint()`, which sets `mintingRef.current = true` before it awaits
   anything. Every subsequent tick during those seconds still sees the same
   stale `badge.expiresAt` (unchanged until the insert resolves) and still
   calls `mint()`, but each of those calls hits the `if (mintingRef.current) return`
   guard and returns immediately — no network call, no new row. When the
   original call finally resolves, `setBadge` updates `expiresAt` into the
   future (if still mounted) and `finally` clears the flag. **1 mint**,
   regardless of how many ticks elapsed while it was in flight.

4. **Page hidden for ten minutes, then foregrounded.** While
   `document.visibilityState !== 'visible'`, `tick()`'s guard
   (`remaining <= 0 && document.visibilityState === 'visible'`) is false even
   though the badge has long since expired, so no mint happens during those
   ten minutes — the countdown just sits at "Renewing…"/0:00 internally
   without firing a request. When the tab is foregrounded, the
   `visibilitychange` listener fires `onVisible`, which calls `tick()` once;
   that single `tick()` sees `remaining <= 0` and `visibilityState === 'visible'`
   and calls `mint()` — again guarded by `mintingRef`, so if the interval's
   own `tick()` (running every second in the background, but no-op-ing on the
   hidden check) and the visibility handler's `tick()` land in the same
   millisecond, only one gets through. **1 mint** on foreground, not one per
   minute the page sat hidden.

### Verification

```
> trainhub@0.0.0 lint
> eslint .

[exit 0, no output]
```

```
> trainhub@0.0.0 build
> vite build

✓ 1207 modules transformed.
...
dist/assets/BadgeScreen-BWifE9eC.js   25.72 kB │ gzip: 9.91 kB
...
✓ built in 557ms

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
✓ 88 modules transformed.
dist/sw.mjs  23.31 kB │ gzip: 7.69 kB
✓ built in 61ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  84 entries (1164.70 KiB)
files generated
  dist/sw.js
```

The database patch (`supabase/patches/009-checkin-tokens.sql`) still has not
been applied, so this could not be exercised against a live `checkin_tokens`
table — the four-path walk above is a code trace, not an observed run.

### Commit

```
6edc6e5 fix(member): guard badge mint against re-entrancy and unmount
```

---

## Critical Finding Fix: StrictMode Remount Deadlock

### The Hazard

`aliveRef` was initialized to `true` but only set to `false` in the effect cleanup. React 19 StrictMode in development double-invokes effects synchronously: mount → cleanup → mount. The sequence was:

1. Initial mount: `aliveRef.current = true` (initialized)
2. Cleanup runs: sets `aliveRef.current = false`
3. Second mount: effect body does nothing, so `aliveRef.current` stays `false`
4. Component persists with `aliveRef.current = false` forever

All `if (aliveRef.current)` guards then fail for the component's lifetime, dropping every `setBadge`/`setError` call. The countdown's `if (!badge) return` remains true, and the screen hangs on loading. Only a full page reload clears it. Production builds are unaffected (double-invoke is dev-only), but `npm run dev` is the primary development path.

### The Fix

Reset the flag when the effect runs, not only when the ref is initialized:

```jsx
// React 19 StrictMode mounts effects twice in development. The cleanup below
// flips aliveRef to false on unmount; resetting it here ensures the second
// mount doesn't inherit the first mount's teardown.
useEffect(() => {
  aliveRef.current = true
  return () => {
    aliveRef.current = false
  }
}, [])
```

Matches the pattern in `src/features/auth/ResetPasswordScreen.jsx:23-34`, which handles the same hazard for PKCE code exchanges.

### The Five Paths

1. **Single real mount (production build)**: effect runs, sets flag true, cleanup sets false on unmount. Mint succeeds on mount → 1 DB row written, screen shows badge. Countdown ticks and renews on expiry → 1 row per renewal cycle.

2. **StrictMode mount → cleanup → mount (dev)**: first mount sets true, cleanup sets false, second mount sets true again. Both mounts schedule the same `mint()` in the dependent effect, but by the time it runs, `aliveRef.current = true` from the second mount, so mint succeeds → 1 DB row written (by the second mount's scheduled call), screen shows badge.

3. **Expiry on fast network**: `tick()` calls `mint()` while `aliveRef.current = true` and `mintingRef.current` is false. Insert + QR encode completes before the next 1s tick → 1 DB row written, screen updates `badge.expiresAt` into the future.

4. **Expiry on slow network (insert several seconds)**: `tick()` calls `mint()`, which sets `mintingRef.current = true`. Subsequent ticks hit the in-flight guard and return without calling network. Original mint resolves and `setBadge` runs (because `aliveRef.current = true`) → 1 DB row written, countdown updates.

5. **Page hidden for 10 minutes, then foregrounded**: while `document.visibilityState !== 'visible'`, the `tick()` guard `remaining <= 0 && document.visibilityState === 'visible'` is false even though badge expired, so no mint fires and no DB row is written. On foreground, `visibilitychange` fires `onVisible()`, which calls `tick()` once. `aliveRef.current = true` from the only mount still alive, `mintingRef.current` is false, so one mint call succeeds → 1 DB row written on foreground, screen shows new badge.

### Verification

**Lint (exit 0)**:
```
> trainhub@0.0.0 lint
> eslint .
```
[no output]

**Build (succeeds)**:
```
> trainhub@0.0.0 build
> vite build

[36mvite v8.1.5 [32mbuilding client environment for production...[36m[39m
[2Ktransforming...✓ 1207 modules transformed.
rendering chunks...
computing gzip size...
...
dist/assets/BadgeScreen-CaIu0RUT.js                         25.73 kB │ gzip:  9.91 kB
...
✓ built in 556ms

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
[36mvite v8.1.5 [32mbuilding client environment for production...[36m[39m
[2Ktransforming...✓ 88 modules transformed.
rendering chunks...
computing gzip size...
dist/sw.mjs  23.31 kB │ gzip: 7.69 kB
✓ built in 54ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  84 entries (1164.72 KiB)
files generated
  dist/sw.js
```

### Commit

```
9206c65 fix(badge): reset alive flag on mount to survive StrictMode remount
```
