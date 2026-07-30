# TrainHub Phase 4B — Access Badge, Scanner and Push Notifications

**Status:** design approved 2026-07-31, ready for an implementation plan.
**Branch:** `phase-4b-badge-scanner-and-push`, from `main` at the Phase 4A merge.

## Goal

Close the last two routes in the app — `/m/profile/badge` and `/p/scan` — and
deliver push notifications end to end. This is the phase that was deliberately
split off from 4A because every piece of it depends on something outside the
codebase: a camera, a real device, VAPID keys, a deployed Edge Function.

After this phase every route in `src/routes/index.jsx` renders real content and
no `<Placeholder />` remains.

## What already exists

Do not rebuild these.

| Path | What it gives |
|---|---|
| `supabase/schema.sql:175` | `checkins (id, member_id, scanned_by_id, created_at)` |
| `supabase/schema.sql:198` | `push_subscriptions (id, user_id, endpoint unique, p256dh, auth, created_at)` |
| `src/sw.js` | The hand-written service worker (injectManifest). Precache logic is not to be touched. |
| `src/features/profile/SettingsScreen.jsx` | Settings for both roles — the notification opt-in goes here |
| `src/features/auth/AuthProvider.jsx` | `signOut`, which already clears the profile mirror and the persisted query cache |
| `src/components/TopHeader.jsx` | Greeting, bell, avatar — present on every screen of both sections |
| `src/data/mutations.js` | Every replayable write is registered here |

`checkin_tokens` does not exist and is created by this phase. `src/sw.js` has no
`push` or `notificationclick` handler yet.

## Decisions taken before planning

Each of these was chosen against a stated alternative; the reasoning is what
makes them reviewable later.

1. **The badge rotates every 60 seconds.** A token is one row, valid for a
   minute, redeemable once. The alternatives were a token per day and a static
   token encoding the member id; both mean a screenshot of the badge, forwarded
   to a friend, is a working key to the gym.
2. **The scanner uses `jsqr` only — `BarcodeDetector` is dropped.** The earlier
   decision was "native with a `jsqr` fallback". One code path is worth more
   than a native decoder here: `BarcodeDetector` does not exist in Chrome on
   Windows, so the two-path version would leave its native branch untestable on
   the machine this project is developed on, and would still ship `jsqr`
   anyway for the fallback.
3. **Three notification events**, not one: a new chat message, an appointment
   whose status changes, and a newly assigned plan. They share a single Edge
   Function and a single SQL helper, so the extra cost is trigger definitions
   and payloads, not code paths. Note that the third event spans two tables —
   `workout_plans` and `nutrition_plans` — so it is four triggers for three
   events, and the notification copy has to name which kind of plan arrived.
4. **The notification is raised by the database, not by the sender's client.**
   A client-side call cannot fire for a message written offline and replayed
   after the app closed, and anyone holding the publishable key could forge one
   for another user.
5. **A token is redeemed through a `security definer` function**, never through
   RLS policies on `checkin_tokens`. The professional must be able to consume a
   token belonging to someone else without ever being able to *read* the token
   table, which a policy-based design would require and which is exactly the
   permission that lets an attacker enumerate valid badges.
6. **Push is verified on Android and on iPhone.** iOS 16.4+ with the PWA
   installed **from Safari** — Web Push does not exist for a site open in an
   iOS browser tab, and Chrome for iOS cannot install it.

## Data model and security

One new table, in a patch:

```sql
create table checkin_tokens (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  token      text not null unique,
  -- The DATABASE owns the clock.  The client never sends this: Phase 2 shipped
  -- a bug where a skewed device clock corrupted stored times, and a badge whose
  -- lifetime is decided by the phone showing it is not a lifetime at all.
  expires_at timestamptz not null default now() + interval '60 seconds',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on checkin_tokens (member_id, expires_at desc);
```

RLS: a member may `insert` and `select` **only their own** rows
(`member_id = auth.uid()`). No `update` policy exists for anyone — the only path
that writes `used_at` is the definer function below, which bypasses RLS by
design. Nobody may read another member's tokens.

```sql
redeem_checkin_token(p_token text) returns record  -- security definer
```

It verifies, in this order: the caller is a professional; the token exists; it
has not expired; it has not been used. Then it stamps `used_at`, inserts into
`checkins` with `scanned_by_id = auth.uid()`, and returns the member's name and
subscription state so the scanner can name the person instead of showing a uuid.
Each failure returns a **distinct** reason — unknown, expired, already used —
because they mean different things to the person at the desk.

A second private table holds the shared secret the database uses to authenticate
itself to the Edge Function. It carries **no policies at all**, which makes it
unreachable through PostgREST, and only the definer notify function reads it.
The patch creates the table; the value is inserted by hand and never committed.

Expired tokens accumulate. At demo scale they are a few dozen bytes each and a
cleanup job would be ceremony; the index is there and a note records that a
`delete from checkin_tokens where expires_at < now() - interval '1 day'` on a
schedule is the answer if it ever matters.

## Screens

### `/m/profile/badge` — the member's badge

Mirrors `doc/assets/gym_member/05A - Access Badge.png`: a back control, the
title, a large QR, and a line of copy beneath it.

The screen mints a token on mount and again when the current one expires, draws
it with `qrcode`, and shows a local countdown. The QR encodes **the token
string only** — not the member id, not a URL. Whoever photographs it holds a
string worth one minute and one entry.

Three properties that are defects if missed:

- **Minting stops when the page is hidden.** A phone locked with the badge open
  would otherwise write one row a minute forever.
- **This write is not registered as a replayable mutation.** It is the second
  case after the password change where the offline queue is the wrong tool: a
  token minted half an hour later, on reconnect, serves nobody. Offline the
  screen says a connection is needed.
- The countdown is cosmetic. Validity is `expires_at`, decided by Postgres and
  checked by `redeem_checkin_token`; a phone with a wrong clock shows a wrong
  countdown and still cannot extend its badge by a second.

### `/p/scan` — the scanner

No wireframe exists for this screen. `getUserMedia({ video: { facingMode:
'environment' } })` into a `<video>`, a canvas sample every 200 ms passed to
`jsQR`, and on a decode a call to `redeem_checkin_token`. The result names the
member and their subscription state, or gives the precise reason it failed.

- A guard prevents the loop from redeeming the same token ten times in the
  200 ms after a successful decode.
- Every track is stopped on unmount. A camera left running is a visible bug.
- `getUserMedia` requires a secure context: the scanner works over the ngrok
  tunnel or on `localhost`, never over a LAN IP.
- Beneath the viewfinder, a field to **type a token by hand**. Five lines, and
  the way out when the camera fails or its permission is denied during a
  demonstration.

## Push notifications

**Keys.** VAPID keys are generated once. The public key ships in the bundle as
`VITE_VAPID_PUBLIC_KEY` — that is its purpose, the browser needs it to
subscribe. The private key exists only as an Edge Function secret: never in the
repository, never in the database. `.env.example` gains the new name.

**Opt-in.** A switch in Settings, for both roles. Enabling calls
`Notification.requestPermission()` **from the click handler** — iOS refuses a
permission request that does not come from a user gesture, without even showing
the dialog — then `pushManager.subscribe`, then an upsert into
`push_subscriptions` on `endpoint`, which is already unique, so a device that
re-subscribes does not accumulate rows. Disabling unsubscribes and deletes the
row.

**Sign-out deletes this device's subscription.** Without it, whoever signs in
next on that phone keeps receiving the previous user's notifications. This is
the same reasoning that already makes `signOut` clear the persisted cache.

**Service worker.** Two handlers are added to `src/sw.js`: `push`, which shows
the notification, and `notificationclick`, which focuses an already-open window
on that URL or opens one. The existing precache logic is untouched.

**From the database to the phone.** One plpgsql function
`notify_user(target, title, body, url)` and four triggers that call it: after
insert on `messages`, after update of `status` on `appointments`, and after
insert on `workout_plans` and on `nutrition_plans`. It posts to the Edge
Function through `pg_net`.

Two properties make this safe rather than fragile:

- `pg_net` is **asynchronous**. It returns a request id immediately, so
  inserting a message never waits on an HTTP call and can never fail because of
  one. An exception handler wraps the call anyway: a lost notification is an
  annoyance, a lost message is a bug.
- The Edge Function **does not trust its caller**. It is deployed without JWT
  verification but requires a shared-secret header, held in the private table
  and as a function secret. Without that check, anyone who learned the URL could
  send any notification to any user.

The function reads the recipient's subscriptions with its own service role key,
sends, and **deletes rows that answer 404 or 410** — dead endpoints, which
otherwise fill the table with devices that no longer exist.

**Recorded deliberately:** the notification body carries a preview of the
message, so it appears on a lock screen. That is what every chat application
does and it is right for this demo, but it is a choice, and the report says so.

## Deviations from the wireframes

1. **The badge's subtitle.** `05A` reads "Valid access everyday from 7AM to
   11PM". Nothing in the schema holds opening hours, and inventing them would be
   a fiction the database cannot back — the same reasoning that replaced the
   wireframe's invented membership number in Phase 4A. The line becomes the
   token's countdown, which is a real fact about the badge on screen.
2. **The scanner has no wireframe.** `doc/assets/pt/` draws no scanning screen,
   so its layout is designed here rather than matched.
3. **No wireframe draws an entry point for `/p/scan`.** The professional's home
   (`pt/04`) has only the new-appointment control. The scanner is reached from a
   QR action in `TopHeader`, shown for the professional only: it is the one
   component present on every screen of that section, and a desk action should
   not be three taps deep. `BottomNav.jsx:7-9` already anticipated that neither
   `/p/scan` nor `/m/profile/badge` is represented by a tab.
4. **No check-in history screen.** `checkins` is written by the scanner and read
   by nothing. The professional gets immediate feedback from the scan itself,
   which is what the flow needs; building a history view only so the row can be
   looked at is a feature of its own. Verification is a SQL query, and the view
   is named as future work in the report.

## Acceptance

- **Badge:** the QR renders; the countdown runs; it regenerates on expiry; it
  stops minting while the page is hidden; offline it asks for a connection
  instead of spinning.
- **Scan:** the professional's phone reads the badge on the member's phone and
  writes a check-in, naming the member and their subscription state. The same QR
  scanned twice says *already used*. A QR older than a minute says *expired*. A
  denied camera permission still leaves the manual field working.
- **Push, on Android and on iPhone**, PWA installed, app closed: a notification
  arrives for each of the three events, the tap opens the right route, the
  Settings switch stops them, and signing out stops them on that device.
- `npm run lint` exits 0, `npm run build` succeeds, and all self-checks pass.
- `verify.sql` still reads PASS on its three security rows and two grant rows.

## Human handoffs

No agent on this project has database credentials, a phone, or a deployment
token. In order:

1. Generate the VAPID keys and the shared notify secret.
2. Enable the `pg_net` extension.
3. Run the badge patch and the push patch, then insert the shared secret by
   hand — the patch leaves the row empty on purpose.
4. `npx supabase login` and `link` (both interactive), then deploy the Edge
   Function. The CLI needs no installation: `npx supabase` resolves 2.110.0.
5. The device runs, on both phones.

Step 4 is the one that can block. If it does, the badge and the scanner are
unaffected and the phase proceeds without push.

## Out of scope

- A check-in history view for either role.
- Gym opening hours, which no table holds.
- Notification preferences finer than one on/off switch.
- Editing one's own profile, still deferred from Phase 4A.
- Enforcing the professional's availability when booking, deferred from 4A.
