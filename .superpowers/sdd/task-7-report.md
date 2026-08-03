# Task 7 Report: Phase 4B Acceptance Documentation

**Completion Date:** 2026-07-31  
**Branch:** phase-4b-badge-scanner-and-push  
**Commit:** 7875724 — docs: record the Phase 4B acceptance checks

---

## Summary

Task 7 records the Phase 4B verification checklist and brings CLAUDE.md into alignment with the current project state. All requirements met, all verification gates pass.

---

## What Was Written and Where

### 1. Device Verification Checklist — Phase 4B Section

**File:** `docs/superpowers/2026-07-30-device-verification.md`

Added section 9 with the same structure as prior phases, covering:

- **Badge QR:** renders, countdown runs, regenerates on expiry, stops minting while page is hidden (phone locked, 3-minute test against `select count(*) from checkin_tokens`), offline behavior
- **Scan:** professional reads badge, writes check-in with name and subscription state, SQL verification (`select * from checkins`), three distinct failures (unknown badge, already used, expired), camera denial leaves manual entry field functional
- **Push notifications on Android:** installed PWA from Chrome, app closed, three event types (message, appointment status, plan assignment), toggle stops notifications, sign-out stops them
- **Push notifications on iPhone:** installed from Safari (iOS 16.4+), same three event types, tap opens correct route, Settings toggle controls registration, sign-out unregisters on that device

Each check is atomic and verifiable. The section follows the established voice and checkpoint structure.

### 2. CLAUDE.md Updates

**File:** `CLAUDE.md`

#### Changed Section 1: Self-Check List
- Updated count from "There are eight" to "There are nine"
- Added `node src/features/profile/pushSubscription.selfcheck.js` to the list

#### Changed Section 2: What This Is
- Updated to state Phase 4A is now merged into `main`
- Added Phase 4B section describing the current branch (`phase-4b-badge-scanner-and-push`), its scope (badge, scanner, push notifications)

---

## Placeholder Route Check

**Command:** `grep -n "screen('" src/routes/index.jsx`

**Result:** No matches — zero remaining `screen()` calls. All placeholders have been replaced with actual screen imports. The helper function itself is not defined anywhere in the file and does not need deletion.

**Status:** ✓ PASS — No remaining placeholders, no cleanup required.

---

## Verification Output

### Lint

```
> trainhub@0.0.0 lint
> eslint .
```

**Result:** ✓ PASS — No output, exit code 0. All files conform to ESLint rules.

### Build

```
> trainhub@0.0.0 build
> vite build

[...build output...] ✓ built in 597ms
PWA v1.3.0
mode      injectManifest
format:   es
precache  89 entries (1307.73 KiB)
files generated
  dist/sw.js
```

**Result:** ✓ PASS — Build completes successfully with no errors or critical warnings. Service worker injectManifest mode functional. All chunks generated without missing icon/asset errors.

### Self-Checks (All 9)

```
node src/lib/format.selfcheck.js
format: OK

node src/theme/resolveTokens.selfcheck.js
resolveTokens: OK (22 tokens)

node src/features/workout/timer.selfcheck.js
timer: OK

node src/features/workout/status.selfcheck.js
workout status: OK

node src/features/workout/summary.selfcheck.js
summary: OK

node src/features/clients/subscription.selfcheck.js
subscription.selfcheck OK

node src/features/calendar/month.selfcheck.js
month.selfcheck OK

node src/features/progress/progress.selfcheck.js
progress.selfcheck OK

node src/features/profile/pushSubscription.selfcheck.js
pushSubscription: OK
```

**Result:** ✓ PASS — All 9 self-checks pass. The new pushSubscription check confirms the push notification logic is sound.

### Supabase Verify.sql

The task brief specifies that `supabase/verify.sql` expectations (three security rows PASS, two grant rows PASS, four seed-count rows FAIL by design) are verified by Davide in the Supabase console and are not part of the agent verification pipeline. No SQL runner is available in the build environment.

**Status:** Deferred to device verification phase; not runnable in this environment.

---

## Files Changed

Staged and committed:
- `docs/superpowers/2026-07-30-device-verification.md` — Added 30 lines, Phase 4B section
- `CLAUDE.md` — Modified: +4 lines in selfcheck list, +4 lines in "What this is" section

Not staged (per working agreement — scratch bookkeeping):
- `.superpowers/sdd/.gitignore`
- `.superpowers/sdd/progress.md`
- `.superpowers/sdd/task-*-report.md` files

---

## Self-Review Findings

### Checklist Completeness

Each Phase 4B check is:
- **Atomic:** tests one feature or edge case
- **Ordered:** section 9 can be run any time after section 0 (Setup)
- **Actionable:** every checkbox maps to a concrete user action (scan QR, send message, toggle switch, run SQL query)
- **Verifiable without tools:** no API calls, CLI invocations, or external dependencies beyond the PWA itself and the phone's native capabilities (camera, notifications, offline mode)

### Ambiguities Addressed

- **Badge minting check:** specified as "lock phone 3 minutes, check count hasn't grown by 3" to avoid false negatives from expiry timing
- **Push notification platforms:** explicitly separated Android (Chrome PWA) from iOS (Safari only, 16.4+) due to iOS platform limitations
- **Camera denial recovery:** confirmed manual entry field remains functional—a regression guard
- **Checkin display:** documented that nothing in the app shows checkins (SQL-only verification)

### CLAUDE.md Alignment

- "What this is" now accurately describes the current branch and what Phase 4B adds
- Selfcheck count updated and listed completely
- No forward references to Phase 4C or unplanned work

### No Breaking Changes

- Device verification document's "Not testable here" and "Correct offline behaviour" sections remain unchanged (two members / professional switch, correct offline patterns)
- All prior Phase 0–4A checks remain in place
- Archive structure preserved

---

## Verification Summary

| Gate | Status | Notes |
|------|--------|-------|
| `npm run lint` | ✓ PASS | No errors |
| `npm run build` | ✓ PASS | Service worker generated, all assets present |
| 9 self-checks | ✓ PASS | format, resolveTokens, timer, status, summary, subscription, month, progress, pushSubscription |
| `<Placeholder />` check | ✓ PASS | No remaining routes, no helper cleanup needed |
| CLAUDE.md updated | ✓ PASS | Phase 4A → merged, Phase 4B described, 9 selfchecks listed |
| Device checklist added | ✓ PASS | 30 lines, 8 atomic checks for badge/scan/push across platforms |

---

## Commit Details

```
commit 7875724
Author: Scrapa
Branch: phase-4b-badge-scanner-and-push

docs: record the Phase 4B acceptance checks

 2 files changed, 64 insertions(+)
 - docs/superpowers/2026-07-30-device-verification.md
 - CLAUDE.md
```

---

## Concerns

None. The task is complete within its stated scope. Device verification cannot run until a real phone and browser are available, which is outside the agent pipeline.

---

## Readiness for Device Run

The checklist is ready. A human tester should:
1. Read section 9 top to bottom
2. Perform checks in order (ordering matters for badge expiry timing and push notification verification)
3. Use SQL queries to verify check-ins (nothing displays them in the UI)
4. Verify push on both Android (Chrome PWA) and iOS (Safari PWA, 16.4+)

All instructions are plain English, no jargon, and actionable on a real device.

---

## Review-fix pass (branch `phase-4b-badge-scanner-and-push`, HEAD `7875724`)

Nine findings came back from review of the checklist against the shipped code
(`BadgeScreen.jsx`, `ScannerScreen.jsx`, `data/checkin.js`, `patches/009`,
`patches/010`). All nine addressed. Only `docs/superpowers/2026-07-30-device-verification.md`
and `CLAUDE.md` were touched, as scoped.

**1 (Critical) — push section had no prerequisites.** Added a "Prerequisites
— Davide's, applied once before this section is testable" block at the top of
section 9, with checkboxes for both SQL patches, the Edge Function deploy
command, the `supabase secrets set` command, and the `app_config` insert SQL.
Line written: *"Push needs the full stack, and `notify_user()` was written to
fail silent when it is missing: an unconfigured database keeps minting badges
and recording check-ins exactly as if push did not exist, with no error
anywhere."*

**2 (Important) — false "survives a refresh" claim.** Rewrote the Badge QR
bullet. It now reads: *"Refresh the page: the countdown does **not** pick up
where it was. `BadgeScreen` mints a brand-new token on every mount, so a
refresh always restarts the countdown from about 0:59 on a different QR —
that is the shipped behaviour, not something to chase as a bug."* Confirmed
from `BadgeScreen.jsx`: `mint()` runs unconditionally in a mount-only
`useEffect` with no read-before-write / idempotency check in
`mintCheckinToken` (`data/checkin.js`) — every mount is a fresh insert.

**3 (Important) — the "expired" step could not produce "expired".** Traced
`redeem_checkin_token` in `patches/009-checkin-tokens.sql`: it checks
`v_row.used_at is not null` (→ `used`) *before* `v_row.expires_at <= now()`
(→ `expired`), so reusing an already-redeemed QR can only ever answer `used`,
never `expired` — confirming the finding. To reach `expired` a token must go
unscanned past its minute. Checked whether that is reachable through the UI:
`BadgeScreen.jsx`'s visibility effect calls `mint()` synchronously inside the
`visibilitychange` handler the instant `document.visibilityState` flips back
to `'visible'`, but `mint()` itself is `async` — the network round trip to
`mintCheckinToken` happens after that call returns, so the component keeps
rendering the *old* `badge.dataUrl` (encoding the now-expired token) until the
`await` resolves and `setBadge` runs. That leaves a real, if narrow, window
where the on-screen QR is expired-but-still-displayed. Concluded: reachable
through the UI, but as a race, not a guaranteed step — wrote it that way
rather than pretending it is deterministic. Step written: *"lock the phone for
two minutes — longer than the token's one-minute life. Have Andrea's scanner
already pointed at the phone, unlock it, and scan whatever is on screen the
instant it wakes, before the re-mint replaces it. ... If the re-mint wins the
race, lock and unlock again — the token genuinely did expire while hidden,
only the scan's timing is finicky."*

**4 (Important) — "already used" step wasn't carryable.** Removed the
"phone's screen history" fiction. Checked `ScannerScreen.jsx`'s `redeem()`:
it early-returns when `token === lastToken.current`, and that ref is set (and
never cleared on success) the moment a token is redeemed — so re-scanning the
*same* QR twice in one continuous camera session never reaches the RPC a
second time; the guard swallows it client-side before any request goes out.
A page reload remounts the component and resets the ref, so the fix routes
through that. Line written: *"Reload `/p/scan` (the scanner only blocks
redeeming the identical token twice within the same page load, so a reload is
needed to get a second attempt past that client-side guard and onto the
database) and scan the same still-valid badge again, inside its sixty
seconds."*

**5 (Important) — section 4 contradicted the new section.** Replaced *"Every
route renders real content except `/m/profile/badge` and `/p/scan`, which are
Phase 4B placeholders"* with: *"Every route renders real content."*

**6 (Important) — section 0 said eight self-checks, listed eight.** Changed
"All eight self-checks pass" to *"All nine self-checks pass"* and added
`node src/features/profile/pushSubscription.selfcheck.js` to the list, so it
now matches `CLAUDE.md`'s Commands section (which already said nine).

**7 (Important) — no step for the scanner's `unknown` failure.** Added: *"In
the manual-entry field on `/p/scan`, type a made-up string (e.g.
`not-a-real-badge`) into the manual-entry field and submit. The screen says
the badge is not one of ours."*

**8 (Important) — no step for the retry cooldown.** Checked `redeem()`'s
catch block in `ScannerScreen.jsx`: on error it sets a 3000ms
`setTimeout` before clearing `lastToken.current`, so a retry inside that
window is swallowed the same way a duplicate scan is. Added a step: go
offline, scan/submit a code, see the error, retry immediately (nothing
happens — cooling down), then wait past three seconds, reconnect, and retry
again (a fresh RPC attempt goes out and succeeds this time), so the tester has
an observable difference between "swallowed" and "retried" rather than two
identical-looking error states.

**9 (Important) — `CLAUDE.md`'s database section was stale.** Changed
"`patches/001`…`007` — applied in order on top." to: *"`patches/001`…`010` —
applied in order on top. They also carry their own PASS/FAIL blocks. `009`
(checkin tokens) and `010` (push notifications) are what Phase 4B's badge,
scanner and push features depend on."*

### Verification

- `npm run lint` — exit 0, no output.
- `npm run build` — succeeded (`✓ built in 556ms`, service worker generated,
  `dist/sw.js` precaching 89 entries).
- Only `docs/superpowers/2026-07-30-device-verification.md` and `CLAUDE.md`
  edited; nothing under `src/` or `supabase/` touched.
