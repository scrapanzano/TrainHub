# Subscription enforcement — whole-branch review fix wave

Branch `subscription-enforcement`, on top of HEAD ac36dc6.

## C1 (Critical) — end-of-workout UI quoted points a suspended member never receives

**`src/features/workout/LiveSessionScreen.jsx`**
- L26: import `isSubscriptionActive` from `../clients/subscription.js`.
- L30: `const { user }` → `const { user, profile }`.
- L116-121: added `const membershipActive = isSubscriptionActive(profile, todayISO())`;
  `const points = alreadyPaid || !membershipActive ? 0 : pointsForRun(exercises, counts)`.
- L258, L279: pass `membershipInactive={!membershipActive}` to `<EndRunSheet>` and `<CongratsDialog>`.

**`src/features/workout/EndRunSheet.jsx`**
- L16-18: added prop `membershipInactive = false`.
- L49-51: `membershipInactive` is now the first branch of the "Finish here" helper text:
  `'Your sets are kept and go to your coach. No points while your membership is inactive.'`

**`src/features/workout/CongratsDialog.jsx`**
- L19-21: added prop `membershipInactive = false`.
- L42-44: `membershipInactive` first branch of the trailing sentence:
  `' No points while your membership is inactive — the work still counts, and your coach still sees it.'`

**`src/features/workout/SessionSummaryScreen.jsx`**
- L10, L14: import `todayISO` and `isSubscriptionActive`.
- L90-93: `const membershipActive = isSubscriptionActive(profile, todayISO())`;
  `const inactiveNoReward = !membershipActive && !reward`.
- Points `<Card>` (~L128-150): both ternaries now branch on `inactiveNoReward` first —
  heading `'No points this time'`, body
  `'No points while your membership is inactive. The workout is saved and your coach still sees it.'`.
  An inactive member with no reward no longer falls through to `Up to +N points` or
  `'This session had already earned on that day.'`. A pre-existing `reward` row still
  shows the real `+${reward.points}` (guarded by `&& !reward`).

The workout still closes normally in every path — no branch touches `finish()`.

**Verified:** `npm run build` resolves all imports; `subscription.selfcheck` green;
manual trace of the four ternaries for `{membershipActive:false, reward:null}`,
`{reward:<row>}`, and the active-member path (unchanged).

## I1 (Important) — AuthProvider never refetched the profile after boot

**`src/features/auth/AuthProvider.jsx`**
- L54-57: added `const [refetchNonce, setRefetchNonce] = useState(0)`.
- L106-121: new effect (deps `[]`) registers `visibilitychange` (bump only when
  `document.visibilityState === 'visible'`) and window `online`, each
  `setRefetchNonce((n) => n + 1)`; both removed on unmount.
- L182: `refetchNonce` added to the profile-fetch effect's dependency array.
- Offline fallback, `PROFILE_UPDATED_EVENT`, the localStorage mirror and the
  `loading` derivation are untouched.

**Verified by reading:** the fetch effect's `if (!sessionReady || !userId) return`
guard means a bump while logged out does nothing; its `active` stale-guard makes a
re-run harmless. A focus regain or `online` fires exactly one `setRefetchNonce`,
hence one refetch. `npm run lint` clean (no `react-hooks` complaint on the new effect).

## I2 (Important) — membership button had no offline affordance

**`src/features/clients/ClientDetailScreen.jsx`**
- L76-79: hoisted `const action = membershipAction(state)` to just after `const state = …`
  (M7); added `const savedOffline = membership.isPending && membership.isPaused`.
- Button block: replaced the `(() => { … })()` IIFE with `{action ? (<Button …/>) : null}`
  matching the file's `cond ? <JSX> : null` idiom (M7).
- Button label: `savedOffline ? 'Saved offline' : membership.isPending ? 'Saving…' : action.label`.
- New `<Alert severity="info" sx={{ width: '100%' }}>` when `savedOffline`:
  "You are offline. This change is saved on your device and will be sent when you reconnect."
- Error Alert and Snackbar unchanged; behaviour otherwise identical.

**Verified:** `npm run build` + `npm run lint` clean; mirrors the `BookingSheet.jsx`
`savedOffline` pattern verbatim.

## M1 — `has_active_subscription` grant removed

**`supabase/patches/023-subscription-enforcement.sql`** L50-51: removed
`grant execute on function public.has_active_subscription(uuid) to authenticated;`,
kept `revoke execute … from public, anon;`, added a comment explaining it is only
called from inside owner-run security-definer functions.
`set_subscription_status_secure` keeps both its revoke and its grant.

**Verified by reading:** no client path calls `has_active_subscription` directly
(`src/data/clients.js` calls `set_subscription_status_secure`); the four gated RPCs
call it as the function owner, unaffected by the missing grant. The patch's PASS/FAIL
block runs as the privileged dashboard role and bypasses grants.

## M2 — null `p_status` guard

**`supabase/patches/023-subscription-enforcement.sql`** (`set_subscription_status_secure`):
`if p_status not in ('active', 'suspended') then` →
`if p_status is null or p_status not in ('active', 'suspended') then`, with a comment
naming the `23502` vs intended `22023` failure. Body otherwise untouched.

## Rec6 — comment attributes the body to patch 016

**`supabase/patches/023-subscription-enforcement.sql`** section 3 header comment:
now names `patches/016` (`016-workout-summary-counts.sql`) as the source revision,
notes it carries the `LEAST(NULL, …)` bugfix, and that 015/016 differ only in
line-wrapping so a re-derive from 015 would be one whitespace change from the bug.
Function body unchanged.

## M3 — selfcheck boundary assertion

**`src/features/clients/subscription.selfcheck.js`** L82-87: added, next to the other
`isSubscriptionActive` cases:
```js
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: TODAY }, TODAY),
  true,
)
```
**Verified:** `node src/features/clients/subscription.selfcheck.js` → `subscription.selfcheck OK`.

## M4 — replace-plan info Alert gated for suspended member

**`src/features/workout/NewPlanScreen.jsx`** L47: `{activePlan.data ? (` →
`{membershipActive && activePlan.data ? (`. The "membership is not active" warning
below is now the only thing a suspended member sees.

## M5 — stale comment above the booking branch chain

**`src/features/trainer/MemberAppointmentsScreen.jsx`** L119-121: comment rewritten to
describe the full chain (inactive membership → no professional → booking card) rather
than only the no-professional case.

## M6 — remove `role="status"` from MembershipBanner

**`src/components/MembershipBanner.jsx`** L30: removed `role="status"` from the `<Box>`.
The Box, the `aria-hidden` icon and the text are unchanged. Rationale: the banner is a
static first-render condition, and two stacked `role="status"` regions (this +
`OfflineBanner`) is worse than none.

---

## Verification output

### Self-checks (all 11)
```
=== src/lib/format.selfcheck.js ===
format: OK
=== src/lib/week.selfcheck.js ===
workout week: OK
=== src/theme/resolveTokens.selfcheck.js ===
resolveTokens: OK (22 tokens)
=== src/features/workout/timer.selfcheck.js ===
timer: OK
=== src/features/workout/status.selfcheck.js ===
workout status: OK
=== src/features/workout/summary.selfcheck.js ===
summary: OK
=== src/features/clients/subscription.selfcheck.js ===
subscription.selfcheck OK
=== src/features/calendar/month.selfcheck.js ===
month.selfcheck OK
=== src/features/progress/progress.selfcheck.js ===
progress.selfcheck OK
=== src/features/profile/pushSubscription.selfcheck.js ===
pushSubscription: OK
=== src/features/nutrition/contracts.selfcheck.js ===
nutrition contracts: OK
```

### `npm run lint`
```
> trainhub@0.0.0 lint
> eslint .
```
(clean, no output)

### `npm run build`
```
✓ built in 650ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
✓ built in 32ms
PWA v1.3.0
mode      injectManifest
precache  106 entries (1398.05 KiB)
files generated
  dist/sw.js
```
No unresolved-import or missing-glyph errors.

---

## Fix wave — pass 2

Re-review of the fix wave found the I1 change turned the profile fetch into a
recurring refetch but left the error branch discarding good cached data on a
failed *refetch* (a real `PGRST301`/5xx/429 is not `isOfflineError`, so `cached`
was `null` and `AppLayout` swapped in the full-screen "Profile unavailable"
panel). M6's `role="status"` removal is also invalidated by I1 — the banner can
now materialise mid-session — so it is restored.

### `src/features/auth/AuthProvider.jsx` — error path of the profile-fetch effect

```diff
-        // Offline with a cached profile is not a failure -- it is the case this
-        // app exists to handle.  Fall back to the cache and let the shell render;
-        // only a denial, or an offline start that was never online, is an error.
-        const offline = isOfflineError(error)
-        const cached = offline ? readCachedProfile(userId) : null
-
-        setProfileState({
-          forUserId: userId,
-          data: cached,
-          error: cached ? null : { ...error, offline },
-        })
+        // A failed refetch must not wipe a good profile off the screen. Keep the
+        // one already loaded for this user; else fall back to the localStorage
+        // mirror when offline. Only a denial with nothing cached is an error --
+        // AppLayout replaces the whole app with a panel on that.
+        const offline = isOfflineError(error)
+
+        setProfileState((prev) => {
+          const kept = prev.forUserId === userId ? prev.data : null
+          const cached = kept ?? (offline ? readCachedProfile(userId) : null)
+          return {
+            forUserId: userId,
+            data: cached,
+            error: cached ? null : { ...error, offline },
+          }
+        })
```

Success path, the `.catch` floor handler, and the `refetchNonce` effect/deps are
untouched.

### `src/components/MembershipBanner.jsx` — restore live region

```diff
     <Box
+      role="status"
       sx={{
         display: 'flex',
```

### Verification of Fix 1's two cases (traced against the re-read effect)

- **First-ever load, fails offline, no cache:** `prev` is `NO_PROFILE`, so
  `prev.forUserId` (`undefined`) `!== userId` → `kept = null`. `offline` is true,
  `readCachedProfile` returns `null` → `cached = null`. Result
  `{ forUserId, data: null, error: { ...error, offline: true } }` — unchanged
  from before.
- **Failed refetch after a good load:** `prev.forUserId === userId`, so
  `kept = prev.data` (the good profile). `cached = kept` regardless of `offline`.
  Result `{ forUserId, data: <good profile>, error: null }` — profile stays on
  screen, no panel.

### `node src/features/clients/subscription.selfcheck.js`
```
subscription.selfcheck OK
```

### `npm run lint`
```
> trainhub@0.0.0 lint
> eslint .
```
(clean)

### `npm run build`
```
✓ built in 51ms
PWA v1.3.0
mode      injectManifest
precache  106 entries (1398.11 KiB)
files generated
  dist/sw.js
```
