# Task 3 report — the professional's scanner

## What I implemented

Followed the brief step by step, verbatim where it gave code:

1. **`npm install jsqr`** — added as the second and last authorised Phase 4B
   dependency (`^1.4.0` in `package.json`).
2. **Confirmed `QrCodeScanner.js` exists** in
   `node_modules/@mui/icons-material/` — it does, so no `QrCode2` fallback
   was needed.
3. **`src/features/checkin/ScannerScreen.jsx`** — new file, the brief's Step 3
   code copied exactly: `getUserMedia` with `facingMode: 'environment'`,
   a 200ms `setInterval` decode loop through `jsQR`, a `lastToken` ref that
   suppresses repeat redemption of the same code still in frame, a cleanup
   that stops every camera track on unmount (including the
   `cancelled`-flag path for when `getUserMedia` resolves after unmount),
   the three-message `MESSAGES` map for `unknown`/`used`/`expired`, and the
   manual-entry fallback form.
4. **`src/components/TopHeader.jsx`** — added an optional `scanHref` prop,
   imported `QrCodeScannerIcon`, and render an `IconButton` linking to it
   before the notification bell, exactly as specified.
5. **`src/layouts/AppLayout.jsx`** — passes
   `scanHref={requiredRole === 'professional' ? '/p/scan' : undefined}` to
   `TopHeader`, so the scan icon only ever appears in the professional shell.
6. **`src/routes/index.jsx`** — replaced the `scan` placeholder entry with a
   lazy route loading `ScannerScreen.jsx`, matching the style of every other
   `/p/...` route in the file.

### One change beyond the brief's literal diff, made for correctness

`scan` was the *last* remaining use of the `screen(name)` placeholder helper
and its `Placeholder` import in `src/routes/index.jsx`. After rewiring the
route, both were dead code and `eslint` flags unused bindings — leaving them
in would have failed the lint gate. I removed the `screen` helper and the
`Placeholder` import from `src/routes/index.jsx`. I did **not** delete
`src/components/Placeholder.jsx` itself (now unused repo-wide) — it wasn't in
the brief's file list and deleting a shared component is a bigger decision
than this task owns; flagging it here rather than acting unilaterally.

## What I verified

`npm run lint` — exit 0, no output beyond the script header:

```
> trainhub@0.0.0 lint
> eslint .
```

`npm run build` — succeeded, service worker built too:

```
> trainhub@0.0.0 build
> vite build
...
✓ built in 563ms
PWA v1.3.0
Building src/sw.js service worker ("es" format)...
...
precache  87 entries (1296.11 KiB)
files generated
  dist/sw.js
```

Both gates pass. I could not exercise the screen end to end — no camera walk,
no live redemption — because `getUserMedia` needs a secure context (localhost
or the ngrok tunnel, never the LAN IP this environment is headless behind)
and `supabase/patches/009-checkin-tokens.sql` is not yet applied to the
database. That browser walk (Coach Andrea, `/p/scan`, scanning Daniel's badge,
confirming the used/expired/manual-entry paths) is Davide's, per the task
instructions — noted, not faked.

## Files changed

- `package.json`, `package-lock.json` — add `jsqr`
- `src/features/checkin/ScannerScreen.jsx` — new
- `src/components/TopHeader.jsx` — `scanHref` prop + icon button
- `src/layouts/AppLayout.jsx` — passes `scanHref` for the professional only
- `src/routes/index.jsx` — `/p/scan` lazy route; dropped the now-dead
  `screen()` placeholder helper and its `Placeholder` import

## Self-review findings

- **Decode-loop constraints held**: single code path through `jsqr`, no
  `BarcodeDetector`; the `lastToken` ref (mutated inside the `setInterval`
  callback, not during render) prevents repeat redemption; the effect cleanup
  stops every track including the `cancelled`-guarded late-resolving
  `getUserMedia` case.
- **Heading levels**: one `<h1>` (`Scan Access Badge`), one `<h2>` (`Enter a
  code by hand`), `<h3>` for the success card's name — matches the brief's
  code exactly, and matches the project's heading-level rule.
- **No `eslint-disable`**, no new colour literals (all `bgcolor`/`color`
  values are theme tokens: `common.black`, `success.main`, `common.white`,
  `text.secondary`), no CSS files.
- **Read/write retry rule**: `redeemCheckinToken` is unchanged from Task 1 —
  it's an RPC write, correctly *not* carrying `.retry()` and correctly *not*
  registered in `src/data/mutations.js` (a replayed check-in after
  reconnecting would fabricate an entry that never happened — the brief and
  the file's own docstring both call this out).
- **Only one new dependency** (`jsqr`) — confirmed via `git diff package.json`.
- **Commit hygiene**: staged only the six paths the brief's Step 7 names;
  the working tree's pre-existing `.superpowers/sdd/` scratch changes
  (`.gitignore`, `progress.md`, `task-1-report.md`, `task-2-report.md` —
  none touched by me this task) were left unstaged, out of the commit.
- Reviewed the `TopHeader` diff for `aria-label` collisions with the existing
  notification button — none; `"Scan an access badge"` is distinct from
  `"No unread messages"` / `"N unread messages"`.

## Issues or concerns

- `src/components/Placeholder.jsx` is now unused anywhere in `src/` (the scan
  route was its last caller). Left in place — out of this task's file list —
  but worth a one-line cleanup commit at the branch-review stage if nobody
  else claims it first.
- End-to-end browser verification (camera permission, real scan against
  Daniel's badge, used/expired/manual-fallback flows) is blocked on the
  unapplied `patches/009-checkin-tokens.sql` and on running the app over
  `localhost`/the tunnel rather than this headless environment — flagged for
  Davide as stated in the task brief, not attempted here.

---

## Phase 4B review fix — three findings in ScannerScreen.jsx

### Finding 1 (Important) — failed redemption cannot be retried

The `redeem` callback set `lastToken.current = token` unconditionally *before*
the async call, and never cleared it. For the three server answers
(`unknown`, `used`, `expired`) this guard is correct — repeating those calls
returns the same answer and wastes the professional's time.

But when the call throws (network hiccup, dropped connection), the check-in
never happened, and retrying the same token is exactly what the professional
needs to do. Today the guard silently swallows every further attempt, including
through the manual-entry form, which calls the same function. The submit button
clears and nothing happens. The only escape is leaving `/p/scan` and coming
back.

**Fix:** Clear the guard on error so the same token can be presented again:

```javascript
const redeem = useCallback(async (token) => {
  if (!token || token === lastToken.current) return
  lastToken.current = token
  try {
    setResult(await redeemCheckinToken(token))
  } catch (cause) {
    lastToken.current = null  // Clear guard on error, enabling retry
    setResult({ status: 'error', message: cause.message })
  }
}, [])
```

### Finding 2 (Minor) — interval can outlive the screen

In the camera effect, after `getUserMedia` resolves, the code checks the
`cancelled` flag, then assigns `srcObject` and awaits `video.play()` before
creating the `setInterval`. If the component unmounts during that await:

1. The cleanup function runs, setting `cancelled = true`
2. Cleanup tries to clear the timer (still null at this point)
3. Cleanup stops the camera tracks
4. The `play()` await resolves
5. Code continues and creates the interval, which will never be cleared

The interval's body no-ops because the video ref is gone, and the camera is
stopped, so the leak is not visible to the user. But the timer itself is left
dangling.

**Fix:** Re-check `cancelled` after the `play()` await, before creating the
interval:

```javascript
videoRef.current.srcObject = stream
await videoRef.current.play()
if (cancelled) {  // Re-check after await
  return
}

timer = setInterval(() => {
  // ... decode loop
}, 200)
```

### Finding 3 (Minor) — unguarded decode can throw

The `jsQR(...)` call inside the 200ms interval tick is not wrapped. A throw on
a malformed frame is an uncaught exception in a timer callback.

**Fix:** Wrap the decode so one bad frame is skipped rather than throwing:

```javascript
let code
try {
  code = jsQR(frame.data, frame.width, frame.height)
} catch {
  return  // Skip frames that fail to decode
}
if (code) redeem(code.data)
```

### Five-path walk (calls vs. screen state)

All paths verified reasoning about the code:

1. **One badge held in frame for five seconds:**
   - First scan (frame 1/2): `redeem()` called (lastToken set), server returns
     `ok`. Screen shows green success card.
   - Subsequent frames (2–25): guard `token === lastToken.current` returns early,
     no more calls made.
   - Result: **1 redemption call**, professional sees success once.

2. **Same badge presented again after server answered `used`:**
   - First scan: `redeem()` called, server returns `used`. lastToken stays set.
   - Professional tries again: guard blocks (token matches), returns early, no
     call made.
   - Result: **1 total call** (from first scan), professional sees `used` stuck
     on screen, submit button clears but nothing happens — cannot retry through
     camera or manual form (both call same `redeem`).

3. **Badge whose redemption throws network error, then same badge presented again:**
   - First scan: `redeem()` called, network error thrown. **New:** lastToken is
     cleared in catch block. Error card shown.
   - Professional tries same badge again: guard check passes (lastToken is null,
     not the token), `redeem()` called again.
   - Result: **2 redemption calls** (retry succeeds), professional can recover
     and check in.

4. **Different badge presented after successful first one:**
   - Badge A scan: `redeem()` called, server returns `ok`. lastToken = Badge A.
     Success card shown.
   - Badge B held in frame: guard check fails (Badge B !== lastToken which is
     Badge A), `redeem()` called for Badge B.
   - Result: **2 redemption calls**, success card updates to Badge B's member.

5. **Screen unmounted while `getUserMedia` is still resolving:**
   - `getUserMedia` promise pending, cleanup has not run yet.
   - Component unmounts: cleanup sets `cancelled = true`, timer is null, stream
     not yet present (or present but tracks are stopped).
   - `getUserMedia` resolves, checks `if (cancelled)` — true, stops stream and
     returns.
   - **New:** Code re-checks `if (cancelled)` after `play()` — true, returns
     before `setInterval` is created.
   - No interval is created, no leak. Cleanup does nothing (timer and stream
     already handled).
   - Result: **No interval leak**, screen gone, camera indicator off
     immediately.

### Verification

`npm run lint` — exit 0:

```
> trainhub@0.0.0 lint
> eslint .
```

`npm run build` — succeeded:

```
> trainhub@0.0.0 build
> vite build

[36mvite v8.1.5 [32mbuilding client environment for production...[36m[39m
[2Ktransforming...✓ 1209 modules transformed.
rendering chunks...
computing gzip size...
...
[32m✓ built in 591ms[39m

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
[36mvite v8.1.5 [32mbuilding client environment for production...[36m[39m
[2Ktransforming...✓ 88 modules transformed.
rendering chunks...
computing gzip size...
...
[32m✓ built in 51ms[39m

PWA v1.3.0
mode      injectManifest
format:   es
precache  87 entries (1296.16 KiB)
files generated
  dist/sw.js
```

### Summary

Three targeted fixes in the same file, all in async callbacks (effect and
interval tick, not during render) so `react-hooks` rules are satisfied:

- `lastToken.current = null` in the catch block allows retry on network error
  while preserving the guard for the three server answers.
- `if (cancelled)` re-check after `play()` await prevents interval creation if
  the screen unmounts during the async operation.
- `jsQR` wrapped in try-catch so one malformed frame is skipped rather than
  throwing into the timer callback.

All three guard the screen's correctness without touching the existing cleanup,
guard roles, status branching, or manual-entry form. Commit: `28f1acf`.

---

## Phase 4B review fix — Important finding: uncapped retry rate on thrown errors

### The finding

The fix above (Finding 1) cleared `lastToken.current` immediately whenever
`redeemCheckinToken` threw, so a check-in that failed on a dropped connection
could be retried. Correct in intent, wrong in rate: the decode loop runs every
200ms, and during a sustained outage the badge is still sitting in frame, so
the very next tick decodes the same token, finds the guard cleared, and calls
the RPC again — up to five calls a second, for as long as the badge stays in
frame, with no backoff and no cap. That hits the backend hardest exactly while
it is already failing.

### The fix

Re-arm the guard after a 3-second cooldown instead of immediately, holding the
timeout in a ref (`cooldownTimer`) so it can be cancelled:

- **On unmount** (camera effect cleanup) — a cooldown must not outlive the
  screen, per the project rule this file has already been reviewed against
  once (Finding 2, this same report).
- **On the start of a new attempt** (top of `redeem`, once the early-return
  guard has passed) — so a different badge presented mid-cooldown is not
  later surprised by a stale clear meant for a badge that is no longer the one
  latched.

The three server answers (`unknown`, `used`, `expired`) are untouched — they
still latch permanently, since only the `catch` branch schedules a cooldown.

### Final code

`redeem`:

```javascript
const redeem = useCallback(async (token) => {
  if (!token || token === lastToken.current) return
  if (cooldownTimer.current) {
    clearTimeout(cooldownTimer.current)
    cooldownTimer.current = null
  }
  lastToken.current = token
  try {
    setResult(await redeemCheckinToken(token))
  } catch (cause) {
    setResult({ status: 'error', message: cause.message })
    cooldownTimer.current = setTimeout(() => {
      lastToken.current = null
      cooldownTimer.current = null
    }, 3000)
  }
}, [])
```

Camera effect's cleanup:

```javascript
return () => {
  cancelled = true
  if (timer) clearInterval(timer)
  if (cooldownTimer.current) {
    clearTimeout(cooldownTimer.current)
    cooldownTimer.current = null
  }
  // A camera left running is a visible bug: the phone's indicator stays lit
  // after the screen is gone.
  if (stream) stream.getTracks().forEach((track) => track.stop())
}
```

A new ref, `cooldownTimer`, sits alongside `lastToken`, declared at the top of
the component. Both `clearTimeout`/`setTimeout` calls touching it happen
inside the `redeem` callback or inside the effect's cleanup — never during
render — so no `react-hooks/refs` violation and no `eslint-disable` was
needed.

### Six-path walk

1. **One badge held in frame for five seconds, server answers `ok`.**
   First tick: `redeem()` called, `lastToken` latches, RPC returns `ok`.
   Every later tick (~24 more over 5s) hits the early-return guard since the
   token still equals `lastToken.current` — success never clears it.
   **1 RPC call total.** Professional sees the green success card once and it
   stays.

2. **The same badge re-presented after the server answered `used`.**
   First scan: `redeem()` called, server returns `used`, `lastToken` latches
   and is never cleared (only the `catch` path schedules a cooldown).
   Re-presenting the badge: every tick hits the guard, no new call.
   **1 RPC call total** (from the original scan). Professional keeps seeing
   "That badge has already been used" for as long as it's in frame.

3. **A badge left in frame for ten seconds while every attempt throws a
   network error.**
   t=0: `redeem()` called, throws, error shown, cooldown scheduled for t=3s.
   t=0.2 → t=2.8 (14 ticks): guard blocks — `lastToken` is still latched to
   this token, cooldown hasn't fired.
   t=3: cooldown fires, `lastToken.current = null`.
   t=3.0/3.2 (next tick): `redeem()` called again, throws again, new cooldown
   scheduled for t=6s. Same pattern repeats: next retry at t≈6s, then t≈9s.
   **4 RPC calls over 10 seconds** (t≈0, 3, 6, 9) — one every 3 seconds, not
   five a second. The professional sees the same error message the whole
   time, refreshed each retry.

4. **A badge that throws once and succeeds on the retry.**
   t=0: `redeem()` called, throws, error shown, cooldown scheduled for t=3s.
   Ticks in between: guard blocks, no calls.
   t=3: cooldown fires, clears `lastToken`.
   t=3.0/3.2: `redeem()` called again, this time `redeemCheckinToken`
   resolves with `ok`. `lastToken` stays latched to this token (success never
   schedules a cooldown or clears it).
   **2 RPC calls total.** Professional sees the error for up to 3 seconds,
   then the green success card, which then holds steady.

5. **A different badge presented two seconds after a failed one.**
   t=0: badge A: `redeem()` called, throws, error shown, cooldown for A
   scheduled at t=3s.
   t=2: badge B appears. `redeem(tokenB)` is called: `tokenB !== lastToken`
   (badge A) passes the guard, so the pending cooldown for badge A is
   cancelled (`clearTimeout`, ref nulled) before `lastToken` is reassigned to
   badge B. Badge B's RPC call proceeds normally.
   Result: badge A's stale timer never fires, so it can never reach back in
   at t=3s and null out `lastToken` while badge B is the one latched — which
   would otherwise have let a leftover badge-A frame or a lingering badge-B
   sit unprotected and re-trigger early.
   **2 RPC calls** (one per badge), each following its own outcome from here
   (path 1 or path 3/4 depending on what badge B's server call does).

6. **The screen unmounted one second into a cooldown.**
   t=0: badge scan throws, cooldown scheduled for t=3s, `cooldownTimer.current`
   holds the timeout id.
   t=1: component unmounts. The camera effect's cleanup runs: `cancelled =
   true`, the decode `timer` interval is cleared, then
   `cooldownTimer.current` is checked, `clearTimeout`'d, and nulled, then the
   camera tracks are stopped.
   The scheduled clear-at-t=3s never fires. **No leaked timer**, matching the
   project's existing rule about this screen (Finding 2, above) that a timer
   must not outlive the component.

### Verification

`npm run lint` — exit 0, no output beyond the script header:

```
> trainhub@0.0.0 lint
> eslint .
```

`npm run build` — succeeded, service worker built too:

```
> trainhub@0.0.0 build
> vite build

vite v8.1.5 building client environment for production...
transforming...✓ 1209 modules transformed.
rendering chunks...
computing gzip size...
...
✓ built in 566ms

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
vite v8.1.5 building client environment for production...
transforming...✓ 88 modules transformed.
rendering chunks...
computing gzip size...
...
✓ built in 54ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  87 entries (1296.31 KiB)
files generated
  dist/sw.js
```

Both gates pass. As before, the screen could not be exercised end to end — no
camera, no secure context, and `supabase/patches/009-checkin-tokens.sql` is
not applied — so this is reasoning about the code, not an observed run.
Nothing else in the file changed: the `cancelled` guard, the track-stopping
cleanup, the try/catch around `jsQR`, the four `status` branches and their
messages, and the manual-entry form (which calls the same `redeem` and so
inherits this behaviour unchanged) are untouched.
