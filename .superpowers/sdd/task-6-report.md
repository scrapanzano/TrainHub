# Task 6 report: the client half of push

## What I implemented

Exactly the brief, file for file:

- `.env.example` — added `VITE_VAPID_PUBLIC_KEY=your-vapid-public-key`.
- `src/data/push.js` (new) — `savePushSubscription({userId, subscription})` (upsert
  on `endpoint`), `deletePushSubscription(endpoint)`. Verbatim from the brief.
- `src/features/profile/pushSubscription.js` (new) — `urlBase64ToUint8Array`,
  `pushSupported`, `currentSubscription`, `enablePush(userId)`, `disablePush()`.
  One deliberate deviation from the brief's literal code, explained below.
- `src/features/profile/pushSubscription.selfcheck.js` (new) — verbatim from the
  brief.
- `src/sw.js` — appended the `push` and `notificationclick` listeners, verbatim,
  after the existing closing comment. Nothing above it touched.
- `src/features/profile/NotificationSwitch.jsx` (new) — verbatim from the brief.
- `src/features/profile/SettingsScreen.jsx` — added the import and a
  `<Card><CardContent><NotificationSwitch /></CardContent></Card>` between the
  password card and the `<Divider />`, verbatim placement from the brief.
- `src/features/auth/AuthProvider.jsx` — added `import { disablePush } from
  '../profile/pushSubscription.js'` and the best-effort `disablePush()` call at
  the top of `signOut`, before the existing local teardown, verbatim from the
  brief.

## The one deviation, and why

The brief's Step 3 code for `pushSubscription.js` has a static top-level
`import { savePushSubscription, deletePushSubscription } from '../../data/push.js'`.
Running the Step 4 self-check exactly as specified failed:

```
node src/features/profile/pushSubscription.selfcheck.js
file:///.../src/lib/supabase.js:3
const url = import.meta.env.VITE_SUPABASE_URL
                            ^
TypeError: Cannot read properties of undefined (reading 'VITE_SUPABASE_URL')
```

`import.meta.env` is a Vite-only construct — under plain Node it is `undefined`,
not even `{}` (confirmed with `node --input-type=module -e "console.log(import.meta.env)"`
→ `undefined`), regardless of what `.env.local` holds. Loading
`pushSubscription.js` therefore always drags in `data/push.js` →
`lib/supabase.js`, which throws unconditionally when `url`/`anonKey` are
missing — exactly the existing, deliberate behavior of that file ("Failing
here beats failing on the first query with an opaque network error"), which is
outside this task's file list and not something I touched.

Every one of the eight pre-existing self-checks avoids this by only importing
modules with zero side-effecting imports (`format.js`, `timer.js`, `status.js`,
etc.) — this is the first selfcheck target whose file mixes pure logic with a
data-layer import, and it is unrunnable under plain `node` as written.

Fix: replaced the static import with two dynamic `import('../../data/push.js')`
calls, one inside `enablePush` and one inside `disablePush`, at the point each
actually needs `savePushSubscription`/`deletePushSubscription`. Behavior in the
browser is identical (Vite code-splits the dynamic import same as any other);
the only change is that a consumer who imports `urlBase64ToUint8Array` alone —
i.e. the self-check — never triggers the `data/push.js` → `supabase.js` chain.
Added a comment at the top of the file explaining why the import is deferred.
No other code in the module changed from the brief's text.

## Import-cycle check for AuthProvider

Traced before adding the import: `pushSubscription.js` imports (dynamically,
after the fix) `data/push.js`, which imports only `lib/supabase.js`.
`lib/supabase.js` imports only `@supabase/supabase-js`. None of that reaches
back into `features/auth/`. `NotificationSwitch.jsx` imports `useAuth.js`,
which imports only `AuthContext.js` (a bare `createContext`, split out
specifically so it carries no component and avoids exactly this kind of
cycle). `AuthProvider.jsx` does not import `NotificationSwitch.jsx` — only
`pushSubscription.js`, for `disablePush`. No cycle.

## Verification

`npm run lint`:

```
> trainhub@0.0.0 lint
> eslint .
```

Exit 0, no output — clean.

`npm run build`:

```
✓ 1212 modules transformed.
...
✓ built in 598ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
✓ 88 modules transformed.
✓ built in 56ms
PWA v1.3.0
mode      injectManifest
format:   es
precache  89 entries (1307.73 KiB)
files generated
  dist/sw.js
```

Build succeeds (the `inlineDynamicImports` deprecation warning from the
vite-plugin-pwa service-worker sub-build is pre-existing tooling noise, not
introduced by this task — same class of warning already appears building the
SW regardless of this task's changes).

All nine self-checks:

```
node src/lib/format.selfcheck.js               → format: OK
node src/theme/resolveTokens.selfcheck.js       → resolveTokens: OK (22 tokens)
node src/features/workout/timer.selfcheck.js    → timer: OK
node src/features/workout/status.selfcheck.js   → workout status: OK
node src/features/workout/summary.selfcheck.js  → summary: OK
node src/features/clients/subscription.selfcheck.js → subscription.selfcheck OK
node src/features/calendar/month.selfcheck.js   → month.selfcheck OK
node src/features/progress/progress.selfcheck.js → progress.selfcheck OK
node src/features/profile/pushSubscription.selfcheck.js → pushSubscription: OK
```

Not verified, and cannot be from here (no VAPID keys, no deployed Edge
Function, no real phone): actual delivery of a push notification end to end,
`Notification.requestPermission()` dialog behavior on a real device, and iOS
Home-Screen-install-only Web Push behavior. `npm run build` confirms the
service worker builds and precaches (89 entries including the new handlers);
an interactive `npm run preview` + DevTools → Application → Service Workers
check for "activated" was not performed in this non-interactive environment.

## Files changed

- `.env.example` (modified)
- `src/data/push.js` (new)
- `src/features/profile/pushSubscription.js` (new)
- `src/features/profile/pushSubscription.selfcheck.js` (new)
- `src/sw.js` (modified — append only)
- `src/features/profile/NotificationSwitch.jsx` (new)
- `src/features/profile/SettingsScreen.jsx` (modified)
- `src/features/auth/AuthProvider.jsx` (modified)

Commit: `c02c806 feat(push): subscribe devices and receive notifications` — 8
files changed, 240 insertions. Scratch bookkeeping under `.superpowers/sdd/`
(pre-existing modifications from earlier tasks, not mine) was left unstaged,
per the brief's exact `git add` command and the project's working agreement.

## Self-review

- **Completeness**: all ten steps done, including documenting the one
  deviation. `<NotificationSwitch />` is mounted where specified. `SettingsScreen`
  still has exactly one `<h1>`; `NotificationSwitch`'s `<Typography variant="h3">`
  is a correctly-leveled card title per the heading rule (MUI's `h3` variant
  already renders an `<h3>` element by default, no `component=` override needed).
- **Quality**: `enablePush` reuses an existing subscription via `??` before
  calling `pushManager.subscribe`, avoiding `InvalidStateError` on a repeat call,
  exactly as given. `disablePush` deletes the row before unsubscribing locally,
  per the brief's stated ordering rationale (an orphaned subscription must not
  outlive the DB row).
- **YAGNI**: no extra abstraction added. The dynamic-import fix is the smallest
  change that makes the selfcheck runnable — two call sites, no new file, no new
  module boundary, no restructuring of `data/push.js` (out of scope) or
  `lib/supabase.js` (explicitly out of scope, and its throw-on-missing-env
  behavior is intentional, documented, and not this task's to change).
- **Constraints**: no new dependency, no `eslint-disable`, no CSS/colour
  literals, both writes correctly absent from `src/data/mutations.js` (matches
  the stated reasoning: replaying a stale subscribe/unsubscribe after the user
  changed their mind would be wrong), `src/data/push.js`'s two writes correctly
  carry no `.retry()` — right per the retry rule (writes must not retry). The
  permission request in `enablePush` only ever runs from `NotificationSwitch`'s
  `onChange` handler (a user gesture), never from an effect; the effect in
  `NotificationSwitch` only calls the read-only `currentSubscription()`, never
  `enablePush`. `disablePush()` in `AuthProvider.signOut` runs from a
  user-initiated sign-out action, not an effect, and is wrapped so its failure
  cannot block the sign-out.
- Nothing else found to fix beyond the deviation above.

## Issues or concerns

- The one deviation (dynamic import in `pushSubscription.js` instead of the
  brief's static import) is a change from the brief's literal text, made
  because the literal text does not pass the brief's own verification step
  (the Step 4 self-check). Flagging explicitly per the instruction to use exact
  code verbatim — this is the one place I did not, and why.
- End-to-end delivery is unverifiable here, as scoped in the assignment: no
  VAPID keys, no deployed Edge Function, no physical device.
