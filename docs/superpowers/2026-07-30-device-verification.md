# TrainHub — device verification checklist

Written 2026-07-30, after `patches/008-messages-update-read.sql` was applied and
Phase 4A's whole-branch review closed. This is the human half of the pipeline:
no agent in this project has had a browser, a phone or database credentials, so
everything below is a check that has never actually run.

Scope, and why it is this long: **Phase 3's browser walk is the only one ever
done.** Phase 0's acceptance task (install, Lighthouse, offline relaunch) was
never started, Phase 1's and Phase 2's per-task checks were all deferred, and
Phase 4A's are new. The ledger records each of them; this file collects them
into one session on a real device.

Work top to bottom — the order matters in two places, both flagged.

---

## 0. Setup

- [ ] `npm run lint` exits 0, `npm run build` succeeds.
- [ ] All eight self-checks pass:
      `node src/lib/format.selfcheck.js`, `src/theme/resolveTokens.selfcheck.js`,
      `src/features/workout/timer.selfcheck.js`, `.../status.selfcheck.js`,
      `.../summary.selfcheck.js`, `src/features/clients/subscription.selfcheck.js`,
      `src/features/calendar/month.selfcheck.js`,
      `src/features/progress/progress.selfcheck.js`.
- [ ] `npm run preview` (port 4173). **Not `npm run dev`** — the service worker
      is not generated in dev, so every PWA check below would be meaningless.
- [ ] `ngrok http 4173 --url=wrinkly-mankind-doodle.ngrok-free.dev`
- [ ] Supabase → Authentication → URL Configuration: the ngrok origin appears
      under **Site URL** and **Redirect URLs**. Without it the password-reset
      email lands on the Site URL with no code and section 5 cannot pass.
- [ ] `supabase/verify.sql`: the three security rows and the two grant rows read
      PASS. The four seed-count rows read FAIL **by design** once `patches/005`
      has run — the comment in the file explains why the expectations were not
      bumped.

Accounts: `daniel@trainhub.dev` (member), `andrea@trainhub.dev` (professional).
Four extra demo clients exist as `auth.users` rows with no identity and cannot
sign in, by design.

Offline on a phone means **airplane mode**, not DevTools. Toggling Wi-Fi alone
leaves a captive network that resolves DNS and makes "offline" ambiguous.

---

## 1. Patch 008 — the security fix you just applied

The patch printed its own PASS/FAIL rows; this is the behavioural half.

- [ ] Read receipts still work: as Daniel open `/m/trainer/chat`, then as Andrea
      look at a message Andrea sent — it carries a **double tick** once Daniel
      has opened the thread. The patch left `read_at` writable and revoked
      everything else, so a broken revoke shows up here first.
- [ ] The unread badge still clears when a thread is opened (section 3).

If either fails with a permission error, `patches/006` was re-run after 008 and
the revoke was undone. Re-run 008.

---

## 2. Phase 0 acceptance — never run, and it is graded

The course requires the app to be installable and to work offline, and the
custom MUI theme is explicitly graded. This section is report chapter 5.

- [ ] **Install on the phone.** Open the ngrok URL in Chrome on Android. Expect
      an install prompt or "Add to Home screen". Install it.
- [ ] It launches **standalone** — no browser chrome, no URL bar.
- [ ] The splash screen and the icon are TrainHub's, and the status bar picks up
      the brand colour `#FE6363`.
- [ ] **Lighthouse**, desktop Chrome against the ngrok URL, Mobile preset.
      Four categories only — **Lighthouse 12 removed the PWA category**, so
      there is no installability audit to look for here any more. Record
      Performance / Accessibility / Best Practices / SEO and **screenshot the
      panel**.
- [ ] **Installability**, which now lives in DevTools → **Application**:
      *Manifest* lists name, icons and theme colour with no errors, and
      *Service Workers* shows one activated and running. Screenshot both; they
      replace the old PWA audit in report chapter 5.
      (Recorded 2026-07-30, login screen: 96 / 94 / 96 / 82. The 82 was a
      missing `<meta name="description">`, since added — re-run to confirm.)
- [ ] **Offline relaunch of the installed app**: airplane mode, then launch it
      from the home screen. It must open and render, not show a network error.
      Do this **while already signed in** — signing in offline is impossible by
      construction (Supabase auth is a network call) and is not a defect. The
      session token and the cached profile are what carry an already-signed-in
      user through a cold offline start.
- [ ] Theme sanity, since this is what the theme grade looks at: background
      `#F9FAFB`, brand `#FE6363`, card radius and pill buttons as in the
      wireframes, and `h1` visibly smaller on the phone than on the desktop
      (that is `responsiveFontSizes` working).

---

## 3. Phase 4A — chat

The two-device round trip is the one check that proves the Realtime path, and it
is the only Phase 4A check that cannot be faked by a reload. Use the phone as
Daniel and desktop Chrome as Andrea.

- [ ] **Live delivery, no reload.** Both sides on the conversation. Andrea sends
      → it appears on Daniel's phone on its own. Daniel replies → it appears on
      Andrea's screen on its own.
- [ ] **The badge is live too.** Daniel on `/m` (not in the chat). Andrea sends.
      Within a minute the bell badge increments — it polls every 60s, so give it
      a minute before calling it broken.
- [ ] **The inbox is live too.** Andrea sitting on `/p/chat` while Daniel sends:
      the row's last message and unread badge update within a minute.
- [ ] `/p/chat` as Andrea: one row for Daniel, last seeded message, unread badge.
      Open it — the badge clears. The **To Read** filter then says "Nothing
      unread". Type `zzz` in the search: "No match", not "No conversations yet".
- [ ] `/m/trainer/chat` as Daniel: the three seeded messages, Andrea's on the
      left, Daniel's on the right, single tick on his own.
- [ ] **Offline send.** Airplane mode on the phone, send a message. It appears in
      the conversation immediately with the "saved on your device" notice, and
      the composer clears. Send a second one — both stay visible.
- [ ] **Offline send survives a reload.** Still offline, reload the app. Both
      queued messages are still on screen.
- [ ] Reconnect. Both land, in the order they were written, and Andrea receives
      them.

---

## 4. Phase 4A — the rest of the member's app

- [ ] Every route renders real content except `/m/profile/badge` and `/p/scan`,
      which are Phase 4B placeholders.
- [ ] `/m/nutrition` as Daniel: "Lean Bulk", 2600 kcal, three macros, four meal
      cards. Tap Breakfast: Oats / Whey / Banana with quantities.
- [ ] The nutrition empty state (wireframe 03B) — needs a member with no
      nutrition plan, so it is only reachable by pointing a demo client at the
      screen or clearing Daniel's plan. Skip if you would rather not touch data.
- [ ] `/m/trainer` as Daniel shows Coach Andrea, with Chat and Book controls.
- [ ] `/m/trainer/browse`: the specialty filter chips read All / Personal
      Trainer / Nutritionist and actually filter. With one professional seeded,
      the only enabled choose button is the current one.
- [ ] `/m/trainer/appointments`: the month grid shows dots on the seeded days,
      and the month step is correct across a short month — from 31 March, back a
      month lands on 28 February, not 3 March.
- [ ] **Book a slot** as Daniel. It appears in his list as "Not confirmed yet".
      As Andrea, `/p/agenda` shows it and confirming it flips the label.
- [ ] **Offline booking**: airplane mode, request an appointment. The sheet says
      it is saved offline. Reconnect — it lands once, not twice.
- [ ] `/m/profile` and `/p/profile`: the two link sets differ and every link
      leads somewhere real.
- [ ] `/m/profile/subscription`: the renewal date is eight months out and the
      chip reads Active. (An em dash here means `subscription_until` is not
      being selected — the Task 8 defect regressed.)

---

## 5. Phase 4A — settings, and the account plumbing from Phase 1

Do section 6 **before** signing out: sign-out now wipes the persisted query
cache, which is the thing the offline cold start reads.

- [ ] `/m/profile/settings` shows Daniel's email. Change the password to
      something else, sign out, sign back in with the new one. Change it back.
- [ ] Password mismatch is rejected before any request; a too-short password
      surfaces the server's message rather than failing silently.
- [ ] Offline, the password form says something rather than hanging — this is
      the one write in the app that must never queue.
- [ ] Sign out works from **both** roles, and signing back in lands on the right
      shell (`/m` for Daniel, `/p` for Andrea).
- [ ] **Password reset by email** (Phase 1, never verified, needs the redirect
      URLs from section 0): request a reset for `daniel@trainhub.dev`, open the
      emailed link **on the phone**, set a new password, and confirm you are
      signed in afterwards. Then set it back.
- [ ] A wrong password shows an error and the button becomes usable again — it
      must not dead-end on a disabled "Logging in…".
- [ ] Signing in as Andrea and typing `/m/nutrition` into the URL bar bounces to
      the professional's shell rather than rendering a member screen.

---

## 6. Offline cold start — the graded claim

Run this **before** section 5's sign-out. It is what "works offline" means in
the course requirements.

- [ ] Online, visit `/m` (home), `/m/nutrition`, `/m/trainer`, `/m/profile`,
      `/m/workout` and the chat, so each one's data is cached.
- [ ] Airplane mode. Hard-reload each of those routes. Every one serves from the
      persisted cache. **No screen shows an error over data it already holds** —
      an error banner above real content is the specific defect this project has
      fixed twice.
- [ ] The offline banner appears, and its copy fits the screen you are on.
- [ ] Reconnect: the banner clears and the screens refresh without a reload.

---

## 7. Phase 2 — the workout half, never verified on a device

- [ ] `/m/workout`: the plan and its sessions render; a finished session reads
      "ALL DONE" rather than "0/8 to go".
- [ ] Start a live session. The timer runs, pause and resume behave, and the
      elapsed time survives a reload of the live screen.
- [ ] Navigate from one live session to another: the timer resets to the new
      session's clock rather than carrying the first one's.
- [ ] Log a set. The count increments immediately.
- [ ] **Double-tap the log button fast.** One set must land, not two.
- [ ] **Offline set logging** — the flagship offline path: airplane mode, log
      several sets across two exercises, then reload while still offline. The
      counts are still there. Reconnect: every set lands exactly once.
- [ ] Finish a session **offline**. The summary must refuse to render a
      fabricated zero-set summary — the offline error state is the correct
      behaviour here, not a bug.
- [ ] Finish a session online: the summary totals match what you logged, and the
      reward appears in `/m/rewards`.
- [ ] The failed-write snackbar: dismissing it once must not silence later
      failures, and it must not render behind the bottom navigation.

---

## 8. Phase 1 — member core, never verified on a device

- [ ] `/m` home: greeting, today's appointments, the week strip, the bell.
- [ ] An appointment card announces its status to a screen reader, not only
      through an icon (TalkBack on the appointment list is enough to confirm).
- [ ] The profile-failure screen: it is reachable only by breaking RLS or the
      profile row, so treat it as verified by Phase 3's run unless you want to
      force it.

---

## 9. Phase 4B — badge, scanner, and push notifications

- [ ] **Badge QR.** `/m/profile/badge` as Daniel: a QR code renders. The
      countdown to expiry runs; refresh the page and it is still counting from
      where it was, not reset.
- [ ] **Badge regeneration.** Wait for the countdown to reach zero. It expires,
      then a new QR appears with a full countdown. Compare tokens in the
      database before and after: `select count(*) from checkin_tokens where member_id = '<daniel>';`
      the count grows by one.
- [ ] **Badge stops minting while hidden.** Lock the phone with `/m/profile/badge`
      open in the browser. Wait three minutes. Then `select count(*) from checkin_tokens where member_id = '<daniel>';`
      — the count has not grown by three.
- [ ] **Badge offline.** Airplane mode, visit `/m/profile/badge`. It does not
      render the QR; instead it says something about needing a connection.
- [ ] **Scan.** `/p/scan` as Andrea. Hold Daniel's phone in front of the camera:
      the badge QR scans, Andrea's screen shows the member's name and their
      subscription state (Lean Bulk, e.g.), and the database now holds a check-in
      (`select * from checkins order by created_at desc limit 1;` names the pair).
      Nothing in the app displays it; this is SQL verification only.
- [ ] **Already used.** Scan the same QR a second time (same badge, which has now
      rotated: take the old one from the phone's screen history or wait for
      expiry and step back in time). Andrea's screen says *already used*.
- [ ] **Expired.** Scan a QR that is older than a minute. The screen says
      *expired*. (This can be the QR from the subscription-state check, which was
      scanned at least a minute ago.)
- [ ] **Camera denied.** Restart the app or clear permissions, then open `/p/scan`.
      When the permission prompt appears, tap Deny. The camera input is gone, but
      the text field for manual entry still accepts input and can submit.
- [ ] **Push notifications, Android.** Phone running Android, app installed as a
      PWA from Chrome. Close the app (not just backgrounded: swipe it away from
      the switcher). As Andrea send Daniel a message → the Android notification
      appears. Tap it → the app opens and shows the chat thread, not the home
      screen. Return to home and tap the Settings icon. **Push Notifications** is
      on by default; toggle it **off** → send another message → no notification.
      Toggle it back on. (If the toggle is already off, this is the correct
      default and the next two checks cover the disabling path.)
- [ ] **Push notifications, iPhone.** Phone running iOS 16.4+, app installed to
      the Home Screen **from Safari** (not Chrome, not a shortcut in a folder —
      Safari's "Add to Home Screen" is the only path that grants Web Push). Close
      the app. As Andrea send a message, confirm the appointment change by
      accepting a booking request, and assign a plan to Daniel → **three**
      notifications, one for each, appear. Tap one → the app opens to the right
      thread or screen (message tap opens chat, appointment tap opens the
      calendar, plan tap opens nutrition).
- [ ] **Push notification opt-out, iOS.** Settings → toggle **Push
      Notifications** off → in the iOS settings for the app itself (Settings →
      TrainHub → Notifications), confirm it is no longer registered. Assign
      another plan as Andrea. No notification. Toggle the app's push back on in
      app settings. iOS Notifications in iOS Settings shows it registered again.
- [ ] **Push stops on sign-out.** As Daniel, Settings → Sign Out. As Andrea,
      send a message and assign a plan. Open the device's notification log (pull
      down the notification shade on Android, swipe down on iOS). No new
      notifications for Daniel's device — they landed on Andrea's, not Daniel's,
      because the subscription was unregistered when Daniel left.

---

## Not testable here

- Two members sharing a professional, or a member switching professional: the
  seed ships one professional, so the switch path stays unreachable until a
  second `profiles` row with `role = 'professional'` exists. The code was fixed
  for it in the Phase 4A final review; it simply cannot be exercised today.

## Correct offline behaviour that looks like a bug

Confirmed on the device 2026-07-30. None of these is a defect.

- **A route never visited online has no data offline.** The screen's code is
  precached so it renders, but its query has nothing to serve and shows its
  offline state. `networkMode: 'offlineFirst'` serves what was cached; it cannot
  invent what was never fetched.
- **Finishing a session offline refuses to show a summary.** Deliberate, and
  found by a Phase 2 review: the sets are sitting as paused mutations that never
  reached Postgres, so a summary would celebrate a workout the database has no
  record of. The offline state is the honest answer.
- **Signing in offline is impossible.** Auth is a network call. Already being
  signed in is what survives.

The rule that separates these from real defects: an error on a screen that holds
**no** usable data is correct; an error banner **above** data the app already has
is the defect.

## Known gaps, expected to fail, do not file them

These are recorded in the ledger with their reasons:

- Booking a slot **outside** the professional's availability is allowed. The
  sheet never reads `availability`; the professional declines instead. Recorded
  as plan-mandated future work.
- Unread messages in a thread abandoned after switching professional keep
  counting toward the bell badge.
- The professional's conversation screen shows "Chat" instead of the client's
  name, though the inbox one tap earlier shows it.
- Choosing a professional reloads the page — `AuthProvider` holds `profile`
  outside the query cache, so nothing else can refresh `assigned_pro_id`.
- Some screens early-return their loading and error states and leave a page with
  no `<h1>`. One cleanup pass is queued for after the merge.
