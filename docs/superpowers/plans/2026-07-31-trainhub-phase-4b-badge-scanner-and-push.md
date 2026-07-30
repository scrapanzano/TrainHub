# TrainHub Phase 4B — Access Badge, Scanner and Push Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last two routes in the app — `/m/profile/badge` and `/p/scan` — and deliver push notifications end to end, so that after this phase no `<Placeholder />` remains in `src/routes/index.jsx`.

**Architecture:** Three independent pieces sharing nothing but the existing shell. The badge mints a 60-second row in a new `checkin_tokens` table and draws it as a QR; the scanner decodes that QR with `jsqr` and redeems it through a `security definer` function that the professional can call without ever being able to read the token table. Push is raised by the database: four triggers call one plpgsql helper, which posts through `pg_net` to one Edge Function that holds the VAPID private key.

**Tech Stack:** React 19, React Router 8, MUI v9, TanStack Query v5, Supabase (Postgres + RLS + Edge Functions + `pg_net`), Vite 8 with `vite-plugin-pwa` in `injectManifest` mode. Two new runtime dependencies, both authorised: `qrcode` and `jsqr`.

Design spec: `docs/superpowers/specs/2026-07-31-trainhub-phase-4b-design.md`. Read its *Decisions taken before planning* before changing any approach here.

## Global Constraints

- Plain JS + JSX. **No TypeScript**, no `.ts`/`.tsx` files in `src/`. ESM only (`"type": "module"`); no `require`. The Edge Function under `supabase/functions/` is the one exception: it is Deno, it is TypeScript, and it never enters the Vite build.
- **Exactly two new runtime dependencies: `qrcode` and `jsqr`.** Both are authorised by Davide. Adding a third is a stop-and-report.
- All user-facing copy in **English**.
- MUI components and the theme in `src/theme/index.js` carry all styling. No CSS files, no colour literals — use `palette.*`, including the custom `palette.task.*` group.
- **Reads gate their error state on `data === undefined`, never on `isError` alone** (`networkMode: 'offlineFirst'`).
- Every Supabase **read** carries `.retry(navigator.onLine)`. **Writes must not** — they pause offline and replay.
- Every **replayable** write is registered in `src/data/mutations.js` via `setMutationDefaults` with a key from `src/lib/mutationKeys.js`; a rehydrated mutation with no registered default is discarded **silently**. This phase adds two writes that are deliberately **not** replayable — see Task 1 — and they must be direct calls, not `useMutation`, following the precedent of the password change in `src/features/profile/SettingsScreen.jsx`.
- Call sites must **not** pass `onSettled` to `useMutation` — the call site is spread last and replaces the registered handler.
- One `<h1>` per screen, section headings `<h2>`, card titles `<h3>`. Use `component=` to fix the level without changing the visual variant.
- **No `eslint-disable` of any kind.** `react-hooks/purity` forbids `Date.now()` and `crypto.randomUUID()` in a render body — both appear in this phase and both belong in an effect or an event handler. `react-hooks/refs` forbids touching `ref.current` during render.
- `npm run lint` must exit 0 **and `npm run build` must succeed** at the end of every task. Lint is not sufficient: ESLint never resolves module paths, so an MUI icon glyph the installed `@mui/icons-material@9.2.0` does not ship passes lint and breaks the build. Phase 3 shipped exactly that. Confirm any new icon exists in `node_modules/@mui/icons-material/` before importing it.
- No test runner exists and none is added. Non-trivial **pure** logic ships an `assert`-based `*.selfcheck.js` run with plain `node <path>`. There are eight; this phase adds one.
- **Dates: compute in the frame you mean.** `new Date('YYYY-MM-DD')` is UTC midnight. `todayISO()` and `localDayISO()` live in `src/lib/format.js`. In this phase the badge's validity is owned by Postgres, never by the device clock.
- Row Level Security is the security boundary, and **it is not the first gate**: Postgres checks the table `GRANT` before it evaluates any policy. `patches/006` set `alter default privileges`, so a table created after it inherits the grant — every new table's patch still asserts that in its PASS/FAIL block rather than assuming it.
- **Secrets never enter the repository.** The VAPID private key and the notify shared secret exist only as Edge Function secrets and, for the secret, as one row inserted by hand. `.env.example` carries names, never values.
- `supabase/` is applied by hand in the Supabase SQL editor — no agent has credentials. Any schema work ends in a handoff to Davide.
- Commits: Conventional Commits, **no `Co-Authored-By` trailer**. Stage only the files a task names; `.superpowers/sdd/` scratch must never enter a feature commit.

---

## What already exists

Do not rebuild these.

| Path | What it gives you |
|---|---|
| `supabase/schema.sql:175` | `checkins (id, member_id, scanned_by_id, created_at)` |
| `supabase/schema.sql:198` | `push_subscriptions (id, user_id, endpoint unique, p256dh, auth, created_at)` |
| `supabase/policies.sql:24` | `is_professional()` — the RLS helper this phase's redeem function reuses |
| `supabase/policies.sql:31` | `owns_member(target uuid)` |
| `src/sw.js` | Hand-written service worker: precache, navigation route, image cache. Its comments explain why no Supabase response is cached — do not touch that. |
| `src/features/profile/SettingsScreen.jsx` | Settings for both roles; the notification switch goes here |
| `src/features/auth/AuthProvider.jsx:143` | `signOut` — clears the profile mirror, the query cache and the persisted copy |
| `src/components/TopHeader.jsx` | Greeting, bell with `notificationCount`, avatar linking to the profile |
| `src/layouts/AppLayout.jsx` | The shell; owns `navItems`, `profileHref` and the unread query |
| `src/components/ScreenState.jsx` | `LoadingState`, `ErrorState`, `EmptyState` |
| `src/features/auth/useAuth.js` | `useAuth()` → `{session, user, profile, profileError, loading, signOut}` |

Routes still `<Placeholder />` in `src/routes/index.jsx`, both replaced by this plan:
`/m/profile/badge` (line 108) and `/p/scan` (line 207).

## Deviations from the wireframes

Decided in the spec. Do not re-litigate.

1. **The badge's subtitle.** `doc/assets/gym_member/05A - Access Badge.png` reads "Valid access everyday from 7AM to 11PM". No table holds opening hours; the line becomes the token countdown.
2. **The scanner has no wireframe.** `doc/assets/pt/` draws no scanning screen.
3. **No wireframe draws an entry point for `/p/scan`.** It is reached from a QR action in `TopHeader`, rendered for the professional only.
4. **No check-in history screen.** `checkins` is written and read by nothing; verification is a SQL query.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `supabase/patches/009-checkin-tokens.sql` | `checkin_tokens`, its policies, and `redeem_checkin_token` |
| `supabase/patches/010-push-notifications.sql` | `app_config`, `notify_user`, four triggers |
| `supabase/functions/notify/index.ts` | The Edge Function that holds the VAPID private key and sends |
| `src/data/checkin.js` | `mintCheckinToken`, `redeemCheckinToken` |
| `src/data/push.js` | `savePushSubscription`, `deletePushSubscription` |
| `src/features/profile/BadgeScreen.jsx` | `/m/profile/badge` |
| `src/features/checkin/ScannerScreen.jsx` | `/p/scan` |
| `src/features/profile/pushSubscription.js` | Browser-side subscribe/unsubscribe, and the VAPID key decoder |
| `src/features/profile/pushSubscription.selfcheck.js` | Assertions for the base64url decoder |
| `src/features/profile/NotificationSwitch.jsx` | The opt-in control used by `SettingsScreen` |

**Modified:**

| Path | Change |
|---|---|
| `package.json` | `qrcode`, `jsqr` |
| `.env.example` | `VITE_VAPID_PUBLIC_KEY` |
| `src/sw.js` | `push` and `notificationclick` handlers |
| `src/components/TopHeader.jsx` | Optional `scanHref` action |
| `src/layouts/AppLayout.jsx` | Passes `scanHref` for the professional |
| `src/features/profile/SettingsScreen.jsx` | Mounts `NotificationSwitch` |
| `src/features/auth/AuthProvider.jsx` | `signOut` also drops this device's push subscription |
| `src/routes/index.jsx` | Wires the two remaining screens |

---

## Task 1: The badge's data layer

**Files:**
- Create: `supabase/patches/009-checkin-tokens.sql`
- Create: `src/data/checkin.js`

**Interfaces:**
- Consumes: `supabase` from `src/lib/supabase.js`.
- Produces:
  - `mintCheckinToken({memberId, token}) -> {token, expires_at}`
  - `redeemCheckinToken(token) -> {status, member_id, full_name, subscription_status, subscription_until}` where `status` is one of `'ok' | 'unknown' | 'used' | 'expired'`

**Neither of these two writes is registered in `src/data/mutations.js`, and that is deliberate.** A badge token replayed half an hour after it was queued mints a token nobody is looking at, and a redemption replayed later checks a member in who went home. Both are direct `await` calls, like `supabase.auth.updateUser` in the settings screen. A reviewer should expect their absence from `mutations.js`, not flag it.

- [ ] **Step 1: Write the patch**

Create `supabase/patches/009-checkin-tokens.sql`:

```sql
-- The member's QR access badge.
--
-- A token is one row, valid for sixty seconds, redeemable once.  The
-- alternatives considered were a token per day and a static token encoding the
-- member id; with either of those a screenshot of the badge, forwarded to a
-- friend, is a working key to the gym.
--
-- `expires_at` is a COLUMN DEFAULT, not a value the client sends.  Phase 2
-- shipped a bug where a skewed device clock corrupted stored times, and a badge
-- whose lifetime is decided by the phone showing it is not a lifetime at all.
-- The countdown on screen is cosmetic; this column is the truth.
--
-- The token itself is client-generated, like every other id in this app that
-- can be written more than once.
--
-- Idempotent: guarded throughout, safe to run twice.

create table if not exists checkin_tokens (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null references profiles(id) on delete cascade,
  token      text not null unique,
  expires_at timestamptz not null default now() + interval '60 seconds',
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists checkin_tokens_member_expires_idx
  on checkin_tokens (member_id, expires_at desc);

alter table checkin_tokens enable row level security;

-- A member may mint and read their OWN tokens.  There is deliberately no
-- update policy and no delete policy for anyone: the only writer of `used_at`
-- is redeem_checkin_token() below, which is `security definer` and bypasses
-- RLS.  A professional never receives the right to READ this table -- that
-- permission is exactly what would let someone enumerate valid badges.
drop policy if exists checkin_tokens_insert_self on checkin_tokens;
create policy checkin_tokens_insert_self on checkin_tokens
  for insert with check (member_id = auth.uid());

drop policy if exists checkin_tokens_select_self on checkin_tokens;
create policy checkin_tokens_select_self on checkin_tokens
  for select using (member_id = auth.uid());

-- Redeem one badge.
--
-- Returns a STATUS rather than raising, because "unknown", "already used" and
-- "expired" are three different things to the person at the desk and each one
-- needs its own message.  The only raise is the authorisation check: a member
-- calling this is not a bad badge, it is a caller who should not be here.
--
-- `for update` locks the row for the length of the transaction, so two
-- simultaneous scans of the same QR cannot both find it unused.
create or replace function redeem_checkin_token(p_token text)
returns table (
  status              text,
  member_id           uuid,
  full_name           text,
  subscription_status text,
  subscription_until  date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row checkin_tokens%rowtype;
begin
  if not is_professional() then
    raise exception 'only a professional may redeem a badge'
      using errcode = '42501';
  end if;

  select * into v_row from checkin_tokens t
  where t.token = p_token
  for update;

  if not found then
    return query select 'unknown'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  if v_row.used_at is not null then
    return query select 'used'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::text, null::text, null::date;
    return;
  end if;

  update checkin_tokens set used_at = now() where id = v_row.id;
  insert into checkins (member_id, scanned_by_id) values (v_row.member_id, auth.uid());

  return query
    select 'ok'::text, p.id, p.full_name,
           p.subscription_status::text, p.subscription_until
    from profiles p
    where p.id = v_row.member_id;
end $$;

-- Every row must read PASS.
--
-- `member can insert` FAIL means the table was created without inheriting the
-- grants `patches/006` installed as default privileges -- RLS would then be
-- irrelevant, because Postgres checks the grant first and answers
-- "42501 permission denied" before any policy runs.
select
  'table exists' as check,
  (to_regclass('public.checkin_tokens') is not null) as ok
union all
select 'rls enabled',
  (select rowsecurity from pg_tables
   where schemaname = 'public' and tablename = 'checkin_tokens')
union all
select 'two policies, no update policy',
  (select count(*) = 2 from pg_policies
   where schemaname = 'public' and tablename = 'checkin_tokens')
union all
select 'redeem function exists',
  (to_regprocedure('public.redeem_checkin_token(text)') is not null)
union all
select 'member can insert',
  has_table_privilege('authenticated', 'public.checkin_tokens', 'insert')
union all
select 'member can select',
  has_table_privilege('authenticated', 'public.checkin_tokens', 'select');
```

- [ ] **Step 2: Write the data module**

Create `src/data/checkin.js`:

```js
import { supabase } from '../lib/supabase.js'

/**
 * Mint one badge token.
 *
 * The caller supplies `token`; `expires_at` is deliberately absent from the
 * insert, because the column default computes it from the DATABASE clock. A
 * device an hour fast would otherwise mint a badge that is already dead, or one
 * that outlives its minute.
 *
 * Not registered in `src/data/mutations.js` on purpose: a token replayed on
 * reconnect, long after the member left the door, is worth nothing to anyone.
 * Offline this simply fails, and the screen says so.
 */
export async function mintCheckinToken({ memberId, token }) {
  const { data, error } = await supabase
    .from('checkin_tokens')
    .insert({ member_id: memberId, token })
    .select('token, expires_at')
    .single()

  if (error) throw error
  return data
}

/**
 * Redeem a scanned badge.
 *
 * The professional never reads `checkin_tokens`; this function is
 * `security definer` and does the checking server-side. It answers with a
 * `status` of 'ok', 'unknown', 'used' or 'expired' -- three different failures
 * that need three different messages -- and, on 'ok', with who just walked in.
 *
 * Not registered in `src/data/mutations.js`: replaying a check-in an hour later
 * records an entry that never happened.
 */
export async function redeemCheckinToken(token) {
  const { data, error } = await supabase
    .rpc('redeem_checkin_token', { p_token: token })
    .single()

  if (error) throw error
  return data
}
```

- [ ] **Step 3: Verify**

Run `npm run lint` (exit 0) and `npm run build` (must succeed). Nothing imports the new module yet; both gates still have to pass.

- [ ] **Step 4: Hand off**

No agent has database credentials. Report:

> Run `supabase/patches/009-checkin-tokens.sql` in the Supabase SQL editor. All
> six rows must read PASS. `member can insert` reading FAIL means the new table
> did not inherit the grants from `patches/006` and every badge request will
> answer `42501 permission denied` before RLS is ever consulted.

- [ ] **Step 5: Commit**

```bash
git add supabase/patches/009-checkin-tokens.sql src/data/checkin.js
git commit -m "feat(checkin): add the badge token table and its redeem function"
```

---

## Task 2: The member's badge screen

**Files:**
- Modify: `package.json` (add `qrcode`)
- Create: `src/features/profile/BadgeScreen.jsx`
- Modify: `src/routes/index.jsx` (replace `/m/profile/badge`)

**Interfaces:**
- Consumes: `mintCheckinToken` from `src/data/checkin.js`, `useAuth`.
- Produces: the `/m/profile/badge` screen. Nothing later depends on it.

Mirrors `doc/assets/gym_member/05A - Access Badge.png`: title, large QR, a line of copy beneath. The wireframe's "Valid access everyday from 7AM to 11PM" becomes the countdown — see Deviations.

- [ ] **Step 1: Install the dependency**

```bash
npm install qrcode
```

Expected: `package.json` gains `"qrcode": "^1.5.4"` or newer under `dependencies`. This is one of the two authorised additions for the phase.

- [ ] **Step 2: Write the screen**

Create `src/features/profile/BadgeScreen.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Card, CardContent, Stack, Typography } from '@mui/material'
import QRCode from 'qrcode'
import { mintCheckinToken } from '../../data/checkin.js'
import { LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/** mm:ss, from a count of seconds. */
function clock(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function BadgeScreen() {
  const { user } = useAuth()
  const [badge, setBadge] = useState(null)
  const [error, setError] = useState(null)
  const [secondsLeft, setSecondsLeft] = useState(0)

  // `crypto.randomUUID()` lives here rather than in the render body:
  // react-hooks/purity forbids it during render, and a token regenerated by
  // every re-render would be a new database row per keystroke elsewhere.
  const mint = useCallback(async () => {
    try {
      const row = await mintCheckinToken({ memberId: user.id, token: crypto.randomUUID() })
      const dataUrl = await QRCode.toDataURL(row.token, { width: 320, margin: 1 })
      setBadge({ expiresAt: row.expires_at, dataUrl })
      setError(null)
    } catch (cause) {
      setBadge(null)
      setError(cause)
    }
  }, [user.id])

  useEffect(() => {
    mint()
  }, [mint])

  useEffect(() => {
    if (!badge) return

    const tick = () => {
      const remaining = new Date(badge.expiresAt).getTime() - Date.now()
      setSecondsLeft(Math.max(0, Math.ceil(remaining / 1000)))
      // Minting stops while the page is hidden. A phone locked with the badge
      // open would otherwise write one row a minute for as long as it sat in a
      // pocket. The visibility listener below picks it back up.
      if (remaining <= 0 && document.visibilityState === 'visible') mint()
    }

    tick()
    const timer = setInterval(tick, 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [badge, mint])

  return (
    <Stack spacing={3} sx={{ p: 2, alignItems: 'center', textAlign: 'center' }}>
      <Typography variant="h1">Access Badge</Typography>

      {/* A badge cannot be minted without a network: the token is a row. This
          is the second write in the app, after the password change, where the
          offline queue is the wrong tool -- a token replayed on reconnect is
          worth nothing to anyone. */}
      {error ? (
        <Alert severity="warning">
          Your badge needs a connection. Reconnect and it will appear.
        </Alert>
      ) : null}

      {!badge && !error ? <LoadingState /> : null}

      {badge ? (
        <>
          <Card sx={{ p: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box
                component="img"
                src={badge.dataUrl}
                alt="Your access badge"
                sx={{ display: 'block', width: '100%', maxWidth: 320, height: 'auto' }}
              />
            </CardContent>
          </Card>

          <Stack spacing={0.5}>
            <Typography variant="h3" color="primary">
              Scan the QR code to enter the gym
            </Typography>
            <Typography color="text.secondary" role="status">
              {secondsLeft > 0
                ? `Valid for ${clock(secondsLeft)} — it renews on its own`
                : 'Renewing…'}
            </Typography>
          </Stack>
        </>
      ) : null}
    </Stack>
  )
}
```

- [ ] **Step 3: Wire the route**

In `src/routes/index.jsx`, replace `{ path: 'profile/badge', ...screen('Access Badge') }`:

```jsx
      {
        path: 'profile/badge',
        lazy: async () => ({
          Component: (await import('../features/profile/BadgeScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 4: Verify**

`npm run lint` (exit 0), `npm run build` (succeeds — this is also the check that `qrcode` resolves in a browser build, which lint cannot tell you).

Browser, as Daniel, `/m/profile/badge`: a QR appears, the countdown runs down from about 0:59 and the code visibly changes when it reaches zero. With DevTools offline, the warning replaces it.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/features/profile/BadgeScreen.jsx src/routes/index.jsx
git commit -m "feat(member): add the QR access badge"
```

---

## Task 3: The professional's scanner

**Files:**
- Modify: `package.json` (add `jsqr`)
- Create: `src/features/checkin/ScannerScreen.jsx`
- Modify: `src/components/TopHeader.jsx`, `src/layouts/AppLayout.jsx`, `src/routes/index.jsx`

**Interfaces:**
- Consumes: `redeemCheckinToken` from `src/data/checkin.js`, `useAuth`.
- Produces: the `/p/scan` screen, and a new optional `scanHref` prop on `TopHeader`.

`BarcodeDetector` is **not** used — see the spec's decision 2. One code path, and it is the one that works in Chrome on Windows, where the native decoder does not exist.

`getUserMedia` requires a secure context: this screen works over the ngrok tunnel or on `localhost`, never over a LAN IP.

- [ ] **Step 1: Install the dependency**

```bash
npm install jsqr
```

- [ ] **Step 2: Confirm the icon exists**

```bash
ls node_modules/@mui/icons-material/QrCodeScanner.js
```

Expected: the file is listed. If it is not, use `QrCode2`, which Phase 4A already imports in `src/features/profile/ProfileScreen.jsx`. An icon that lints and does not exist breaks the build — Phase 3 shipped exactly that.

- [ ] **Step 3: Write the screen**

Create `src/features/checkin/ScannerScreen.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import jsQR from 'jsqr'
import { redeemCheckinToken } from '../../data/checkin.js'

const MESSAGES = {
  unknown: 'That badge is not one of ours.',
  used: 'That badge has already been used. Ask for a fresh one.',
  expired: 'That badge has expired. Ask the member to reopen the screen.',
}

export default function ScannerScreen() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  // The decode loop fires five times a second; without this the same QR is
  // redeemed repeatedly in the moment it stays in frame.
  const lastToken = useRef(null)
  const [result, setResult] = useState(null)
  const [cameraError, setCameraError] = useState(null)
  const [manual, setManual] = useState('')

  const redeem = useCallback(async (token) => {
    if (!token || token === lastToken.current) return
    lastToken.current = token
    try {
      setResult(await redeemCheckinToken(token))
    } catch (cause) {
      setResult({ status: 'error', message: cause.message })
    }
  }, [])

  useEffect(() => {
    let stream = null
    let timer = null
    let cancelled = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        videoRef.current.srcObject = stream
        await videoRef.current.play()

        timer = setInterval(() => {
          const video = videoRef.current
          const canvas = canvasRef.current
          if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return

          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const frame = context.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(frame.data, frame.width, frame.height)
          if (code) redeem(code.data)
        }, 200)
      } catch (cause) {
        setCameraError(cause)
      }
    }

    start()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      // A camera left running is a visible bug: the phone's indicator stays lit
      // after the screen is gone.
      if (stream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [redeem])

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Scan Access Badge</Typography>

      {cameraError ? (
        <Alert severity="warning">
          The camera is unavailable. Check the permission, or type the code below.
        </Alert>
      ) : (
        <Box
          sx={{
            position: 'relative',
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: 'common.black',
            aspectRatio: '1 / 1',
          }}
        >
          <Box
            component="video"
            ref={videoRef}
            muted
            playsInline
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Box>
      )}

      {/* Never rendered: it is the frame buffer jsQR reads. */}
      <Box component="canvas" ref={canvasRef} sx={{ display: 'none' }} />

      {result?.status === 'ok' ? (
        <Card sx={{ bgcolor: 'success.main', color: 'common.white' }}>
          <CardContent>
            <Typography variant="h3">{result.full_name}</Typography>
            <Typography>Checked in — subscription {result.subscription_status}</Typography>
          </CardContent>
        </Card>
      ) : null}

      {result && result.status !== 'ok' ? (
        <Alert severity="error">{MESSAGES[result.status] ?? result.message}</Alert>
      ) : null}

      <Stack
        component="form"
        spacing={1}
        onSubmit={(event) => {
          event.preventDefault()
          const token = manual.trim()
          if (token === '') return
          setManual('')
          redeem(token)
        }}
      >
        <Typography variant="h2">Enter a code by hand</Typography>
        <Typography variant="body2" color="text.secondary">
          For when the camera will not start.
        </Typography>
        <TextField
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          label="Badge code"
          fullWidth
        />
        <Button type="submit" variant="outlined" disabled={manual.trim() === ''}>
          Check in
        </Button>
      </Stack>
    </Stack>
  )
}
```

- [ ] **Step 4: Add the entry point**

No wireframe draws one — see Deviations. In `src/components/TopHeader.jsx`, accept an optional `scanHref` and render it before the bell:

```jsx
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner'
```

```jsx
export default function TopHeader({ profileHref, notificationCount = 0, scanHref }) {
```

```jsx
        {scanHref ? (
          <IconButton component={Link} to={scanHref} aria-label="Scan an access badge">
            <QrCodeScannerIcon />
          </IconButton>
        ) : null}
```

In `src/layouts/AppLayout.jsx`, pass it for the professional only:

```jsx
        <TopHeader
          profileHref={profileHref}
          notificationCount={unread.data ?? 0}
          scanHref={requiredRole === 'professional' ? '/p/scan' : undefined}
        />
```

- [ ] **Step 5: Wire the route**

In `src/routes/index.jsx`, replace `{ path: 'scan', ...screen('Scan Access Badge') }`:

```jsx
      {
        path: 'scan',
        lazy: async () => ({
          Component: (await import('../features/checkin/ScannerScreen.jsx')).default,
        }),
      },
```

- [ ] **Step 6: Verify**

`npm run lint`, `npm run build`.

In the browser as Coach Andrea over `localhost` or the tunnel — **not** a LAN IP, where `getUserMedia` is blocked — the QR icon appears in the header, `/p/scan` opens the camera, and pointing it at Daniel's badge names him. Scanning the same code twice says *already used*; a code left on screen for over a minute says *expired*; denying the camera leaves the manual field working.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/features/checkin src/components/TopHeader.jsx src/layouts/AppLayout.jsx src/routes/index.jsx
git commit -m "feat(checkin): add the badge scanner"
```

---

## Task 4: The push trigger in the database

**Files:**
- Create: `supabase/patches/010-push-notifications.sql`

**Interfaces:**
- Consumes: `push_subscriptions` (already in `schema.sql`), the `pg_net` extension.
- Produces: `notify_user(uuid, text, text, text)` and four triggers. Nothing in `src/` calls these.

Three events, four triggers: "a plan was assigned" spans `workout_plans` and `nutrition_plans`, and the copy has to say which kind arrived.

- [ ] **Step 1: Write the patch**

Create `supabase/patches/010-push-notifications.sql`:

```sql
-- Push notifications, database half.
--
-- The notification is raised HERE rather than by the sender's client for two
-- reasons: a client-side call cannot fire for a message written offline and
-- replayed after the app was closed, and anyone holding the publishable key --
-- which ships in the JS bundle -- could forge one for another user.
--
-- `net.http_post` is ASYNCHRONOUS: it queues the request and returns an id, so
-- inserting a message never waits on an HTTP call and cannot fail because of
-- one.  The exception handler is there anyway: a lost notification is an
-- annoyance, a lost message is a bug.
--
-- Idempotent: guarded throughout.

create extension if not exists pg_net;

-- Configuration the database needs and nobody else may read.
--
-- RLS is enabled with NO policies, which denies every PostgREST caller, and the
-- grants are revoked as well -- Postgres checks the grant before the policy, so
-- that is the gate that actually runs first.  Only notify_user(), which is
-- `security definer` and owned by the superuser, reads this table.
create table if not exists app_config (
  key   text primary key,
  value text not null
);

alter table app_config enable row level security;
revoke all on table app_config from anon, authenticated;

-- Send one notification.  Never raises into its caller.
create or replace function notify_user(
  p_user  uuid,
  p_title text,
  p_body  text,
  p_url   text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select value into v_url    from app_config where key = 'notify_function_url';
  select value into v_secret from app_config where key = 'notify_secret';

  -- Unconfigured is not an error: the badge and the scanner must keep working
  -- on a database where the Edge Function was never deployed.
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-notify-secret', v_secret),
    body    := jsonb_build_object(
                 'user_id', p_user,
                 'title',   p_title,
                 'body',    p_body,
                 'url',     p_url)
  );
exception when others then
  raise warning 'notify_user failed for %: %', p_user, sqlerrm;
end $$;

-- 1. A new chat message notifies the OTHER party.
create or replace function notify_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_sender text;
begin
  select case when t.member_id = new.sender_id then t.pro_id else t.member_id end
  into v_target
  from threads t where t.id = new.thread_id;

  select full_name into v_sender from profiles where id = new.sender_id;

  perform notify_user(
    v_target,
    coalesce(v_sender, 'New message'),
    left(new.body, 120),
    case when v_target = (select member_id from threads where id = new.thread_id)
         then '/m/trainer/chat'
         else '/p/chat/' || new.thread_id::text
    end);
  return null;
end $$;

drop trigger if exists on_message_notify on messages;
create trigger on_message_notify
  after insert on messages
  for each row execute function notify_on_message();

-- 2. A change of appointment status notifies the member.
create or replace function notify_on_appointment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  perform notify_user(
    new.member_id,
    'Appointment ' || new.status,
    to_char(new.starts_at, 'Dy DD Mon at HH24:MI'),
    '/m/trainer/appointments');
  return null;
end $$;

drop trigger if exists on_appointment_status_notify on appointments;
create trigger on_appointment_status_notify
  after update of status on appointments
  for each row execute function notify_on_appointment_status();

-- 3 and 4. A newly assigned plan notifies the member.  Two tables, one event,
-- and the copy names which kind arrived.
create or replace function notify_on_workout_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_user(new.member_id, 'New workout plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/workout');
  return null;
end $$;

drop trigger if exists on_workout_plan_notify on workout_plans;
create trigger on_workout_plan_notify
  after insert on workout_plans
  for each row execute function notify_on_workout_plan();

create or replace function notify_on_nutrition_plan() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_user(new.member_id, 'New nutrition plan',
                      coalesce(new.name, 'Your plan is ready.'), '/m/nutrition');
  return null;
end $$;

drop trigger if exists on_nutrition_plan_notify on nutrition_plans;
create trigger on_nutrition_plan_notify
  after insert on nutrition_plans
  for each row execute function notify_on_nutrition_plan();

-- Every row must read PASS.
--
-- `config unreadable by the app role` is the one that matters: if it reads
-- FAIL, the shared secret that authenticates the database to the Edge Function
-- is readable by anyone holding the publishable key.
select 'pg_net installed' as check,
  (select count(*) = 1 from pg_extension where extname = 'pg_net') as ok
union all
select 'notify_user exists',
  (to_regprocedure('public.notify_user(uuid,text,text,text)') is not null)
union all
select 'four triggers',
  (select count(*) = 4 from pg_trigger
   where tgname in ('on_message_notify', 'on_appointment_status_notify',
                    'on_workout_plan_notify', 'on_nutrition_plan_notify'))
union all
select 'config unreadable by the app role',
  (not has_table_privilege('authenticated', 'public.app_config', 'select'));
```

- [ ] **Step 2: Hand off**

Report, verbatim:

> Run `supabase/patches/010-push-notifications.sql`. All four rows must read
> PASS. Then insert the two configuration values **by hand** — they are secrets
> and must never be committed:
>
> ```sql
> insert into app_config (key, value) values
>   ('notify_function_url', 'https://<project-ref>.supabase.co/functions/v1/notify'),
>   ('notify_secret',       '<the shared secret you generated>')
> on conflict (key) do update set value = excluded.value;
> ```
>
> Until those rows exist, `notify_user` returns quietly and nothing else in the
> app is affected — that is deliberate, so the badge and the scanner work on a
> database where the Edge Function was never deployed.

- [ ] **Step 3: Commit**

```bash
git add supabase/patches/010-push-notifications.sql
git commit -m "feat(push): raise notifications from the database"
```

---

## Task 5: The Edge Function

**Files:**
- Create: `supabase/functions/notify/index.ts`

**Interfaces:**
- Consumes: the JSON body `notify_user` posts — `{user_id, title, body, url}` — and the `x-notify-secret` header.
- Produces: nothing the app imports. It is deployed, not bundled.

This is the one TypeScript file in the project, and it never enters the Vite build. It runs on Deno.

- [ ] **Step 1: Write the function**

Create `supabase/functions/notify/index.ts`:

```ts
// Sends one Web Push notification to every device a user has registered.
//
// Deployed WITHOUT JWT verification, because its caller is Postgres, which has
// no user session. It authenticates that caller with a shared secret instead.
// Without this check anyone who learned the URL could push anything to anyone.
//
//   npx supabase functions deploy notify --no-verify-jwt
//
// Secrets it expects (set with `npx supabase secrets set NAME=value`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, NOTIFY_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (request) => {
  if (request.headers.get('x-notify-secret') !== Deno.env.get('NOTIFY_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  const { user_id, title, body, url } = await request.json()

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user_id)

  if (error) return new Response(error.message, { status: 500 })

  const payload = JSON.stringify({ title, body, url })

  const results = await Promise.allSettled(
    (subscriptions ?? []).map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
      ),
    ),
  )

  // 404 and 410 mean the browser threw the subscription away -- the app was
  // uninstalled, or the user cleared their data. Keeping those rows means
  // pushing to devices that no longer exist, forever.
  const dead = results.flatMap((result, index) =>
    result.status === 'rejected' &&
    [404, 410].includes((result.reason as { statusCode?: number }).statusCode ?? 0)
      ? [subscriptions![index].id]
      : [],
  )
  if (dead.length > 0) await admin.from('push_subscriptions').delete().in('id', dead)

  return new Response(JSON.stringify({ sent: results.length, pruned: dead.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2: Verify what can be verified here**

`npm run lint` and `npm run build`. Neither touches this file — ESLint's config covers `src/`, and Vite never sees `supabase/`. Confirm that is true rather than assuming: the build output must not mention `supabase/functions`. If ESLint does try to parse it, add `supabase/functions` to the ignore list rather than converting the file to JS; Deno needs the types.

- [ ] **Step 3: Hand off**

> Deploy it:
>
> ```bash
> npx supabase login
> npx supabase link --project-ref <project-ref>
> npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
>   VAPID_SUBJECT=mailto:you@example.com NOTIFY_SECRET=...
> npx supabase functions deploy notify --no-verify-jwt
> ```
>
> The VAPID pair comes from `npx web-push generate-vapid-keys`. The public key
> also goes in `.env.local` as `VITE_VAPID_PUBLIC_KEY`; the private key exists
> only here. `NOTIFY_SECRET` must equal the `notify_secret` row inserted in
> Task 4.
>
> `login` and `link` are interactive. If either fails, push stops here and the
> rest of the phase is unaffected.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/notify/index.ts
git commit -m "feat(push): add the notify edge function"
```

---

## Task 6: The client half of push

**Files:**
- Create: `src/data/push.js`, `src/features/profile/pushSubscription.js`, `src/features/profile/pushSubscription.selfcheck.js`, `src/features/profile/NotificationSwitch.jsx`
- Modify: `src/sw.js`, `src/features/profile/SettingsScreen.jsx`, `src/features/auth/AuthProvider.jsx`, `.env.example`

**Interfaces:**
- Consumes: `supabase`, `VITE_VAPID_PUBLIC_KEY`.
- Produces:
  - `savePushSubscription({userId, subscription})`, `deletePushSubscription(endpoint)`
  - `urlBase64ToUint8Array(base64)`, `enablePush(userId)`, `disablePush()`, `currentSubscription()`
  - `<NotificationSwitch />`

- [ ] **Step 1: Name the variable**

Append to `.env.example`:

```
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key
```

The public key belongs in the bundle — the browser needs it to subscribe. The private key never leaves the Edge Function's secrets.

- [ ] **Step 2: Write the data module**

Create `src/data/push.js`:

```js
import { supabase } from '../lib/supabase.js'

/**
 * Record this device's subscription.
 *
 * `endpoint` is unique in the schema, so re-subscribing the same device updates
 * its row instead of accumulating a second one. Not registered in
 * `src/data/mutations.js`: a subscription replayed after the user turned
 * notifications off would silently turn them back on.
 */
export async function savePushSubscription({ userId, subscription }) {
  const json = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw error
}

/** Forget one device. */
export async function deletePushSubscription(endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}
```

- [ ] **Step 3: Write the browser half**

Create `src/features/profile/pushSubscription.js`:

```js
import { savePushSubscription, deletePushSubscription } from '../../data/push.js'

/**
 * VAPID keys are published as base64url; `pushManager.subscribe` wants raw
 * bytes. base64url swaps `+/` for `-_` and drops the padding, so neither the
 * substitution nor the padding can be skipped -- `atob` rejects the string
 * outright without them.
 */
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

/** True when this browser can do Web Push at all. */
export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** This device's current subscription, or null. */
export async function currentSubscription() {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

/**
 * Subscribe this device.
 *
 * MUST be called from a user gesture: iOS refuses a permission request that did
 * not come from one, without even showing the dialog. iOS also requires the PWA
 * to have been installed to the Home Screen from Safari -- Web Push does not
 * exist for a site open in a browser tab there.
 */
export async function enablePush(userId) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site.')

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Chrome refuses a subscription that might deliver silently.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    }))

  await savePushSubscription({ userId, subscription })
  return subscription
}

/**
 * Unsubscribe this device and forget the row.
 *
 * The row goes first: a device that unsubscribed locally but stayed in the
 * table is a phone the Edge Function keeps pushing to until the endpoint rots.
 */
export async function disablePush() {
  const subscription = await currentSubscription()
  if (!subscription) return
  await deletePushSubscription(subscription.endpoint)
  await subscription.unsubscribe()
}
```

- [ ] **Step 4: Self-check the decoder**

It is the only pure logic in this task, and a wrong byte produces a subscription that fails at the push service rather than at the call.

Create `src/features/profile/pushSubscription.selfcheck.js`:

```js
import assert from 'node:assert/strict'
import { urlBase64ToUint8Array } from './pushSubscription.js'

// `atob` is global in Node 18+, as it is in the browser.

// Padding is re-added: 'AQAB' needs none, 'AQA' needs one '='.
assert.deepEqual(Array.from(urlBase64ToUint8Array('AQAB')), [1, 0, 1])

// base64url's substitutions must be undone, or atob throws.
// '-_8' is base64url for the bytes 0xFB 0xFF.
assert.deepEqual(Array.from(urlBase64ToUint8Array('-_8')), [251, 255])

// A real 65-byte P-256 public key decodes to exactly 65 bytes, and starts with
// the 0x04 uncompressed-point marker.
const key =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const bytes = urlBase64ToUint8Array(key)
assert.equal(bytes.length, 65)
assert.equal(bytes[0], 4)

console.log('pushSubscription: OK')
```

Run it:

```bash
node src/features/profile/pushSubscription.selfcheck.js
```

Expected: `pushSubscription: OK`.

- [ ] **Step 5: Teach the service worker to receive**

Append to `src/sw.js`:

```js
// Push arrives when no page of ours is running, which is the whole point of the
// feature: the service worker is the only thing alive to show it.
self.addEventListener('push', (event) => {
  // A push whose payload will not parse still has to show something, because
  // Chrome shows its own "This site has been updated in the background" notice
  // if the handler ends without one.
  let payload = { title: 'TrainHub', body: '', url: '/' }
  try {
    payload = { ...payload, ...event.data.json() }
  } catch {
    // Keep the default.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url ?? '/'

  // Focus a window that is already open rather than stacking a second one.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.includes(target))
      if (open) return open.focus()
      return self.clients.openWindow(target)
    }),
  )
})
```

- [ ] **Step 6: Write the switch**

Create `src/features/profile/NotificationSwitch.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { Alert, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import { currentSubscription, disablePush, enablePush, pushSupported } from './pushSubscription.js'
import { useAuth } from '../auth/useAuth.js'

export default function NotificationSwitch() {
  const { user } = useAuth()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    currentSubscription().then((subscription) => {
      if (active) setOn(Boolean(subscription))
    })
    return () => {
      active = false
    }
  }, [])

  // Called straight from the change event, not from an effect: iOS refuses a
  // permission request that is not the direct result of a user gesture.
  const toggle = async (event) => {
    const next = event.target.checked
    setBusy(true)
    setError(null)
    try {
      if (next) await enablePush(user.id)
      else await disablePush()
      setOn(next)
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  if (!pushSupported()) {
    return (
      <Alert severity="info">
        This browser does not support notifications. On iPhone, add TrainHub to the Home Screen
        from Safari first.
      </Alert>
    )
  }

  return (
    <Stack spacing={1}>
      <Typography variant="h3">Notifications</Typography>
      <Typography variant="body2" color="text.secondary">
        New messages, appointment updates and new plans, on this device.
      </Typography>
      <FormControlLabel
        control={<Switch checked={on} onChange={toggle} disabled={busy} />}
        label={on ? 'On' : 'Off'}
      />
      {error ? <Alert severity="error">{error.message}</Alert> : null}
    </Stack>
  )
}
```

- [ ] **Step 7: Mount it in Settings**

In `src/features/profile/SettingsScreen.jsx`, add the import and a card between the password card and the `<Divider />`:

```jsx
import NotificationSwitch from './NotificationSwitch.jsx'
```

```jsx
      <Card>
        <CardContent>
          <NotificationSwitch />
        </CardContent>
      </Card>
```

- [ ] **Step 8: Drop the subscription on sign-out**

In `src/features/auth/AuthProvider.jsx`, inside `signOut`, before the existing local teardown:

```jsx
    // Whoever signs in next on this device must not keep receiving the previous
    // user's notifications. Best effort: a failure here must not prevent the
    // sign-out itself, which is the same reasoning that already clears the
    // profile mirror before the network call.
    try {
      await disablePush()
    } catch {
      // Ignored on purpose.
    }
```

with `import { disablePush } from '../profile/pushSubscription.js'` at the top. Check for an import cycle first: `pushSubscription.js` imports `src/data/push.js`, which imports only `src/lib/supabase.js`, so there is none.

- [ ] **Step 9: Verify**

`npm run lint`, `npm run build`, and all nine self-checks:

```bash
node src/lib/format.selfcheck.js
node src/theme/resolveTokens.selfcheck.js
node src/features/workout/timer.selfcheck.js
node src/features/workout/status.selfcheck.js
node src/features/workout/summary.selfcheck.js
node src/features/clients/subscription.selfcheck.js
node src/features/calendar/month.selfcheck.js
node src/features/progress/progress.selfcheck.js
node src/features/profile/pushSubscription.selfcheck.js
```

The service worker only exists in a production build: `npm run build && npm run preview`, then DevTools → Application → Service Workers shows one activated.

- [ ] **Step 10: Commit**

```bash
git add .env.example src/data/push.js src/features/profile/pushSubscription.js src/features/profile/pushSubscription.selfcheck.js src/features/profile/NotificationSwitch.jsx src/features/profile/SettingsScreen.jsx src/features/auth/AuthProvider.jsx src/sw.js
git commit -m "feat(push): subscribe devices and receive notifications"
```

---

## Task 7: Phase acceptance

**Files:**
- Modify: `docs/superpowers/2026-07-30-device-verification.md`
- Modify: `CLAUDE.md`

**Interfaces:** none. This task ships no behaviour.

- [ ] **Step 1: Extend the device checklist**

Add a Phase 4B section to `docs/superpowers/2026-07-30-device-verification.md`, in the same shape as the existing ones:

- Badge: the QR renders; the countdown runs; it regenerates on expiry; it stops minting while the page is hidden (lock the phone for three minutes, then check `select count(*) from checkin_tokens where member_id = ...` has not grown by three); offline it asks for a connection.
- Scan: the professional's phone reads the badge on the member's phone and writes a check-in, naming the member and their subscription state. The same QR twice says *already used*. A QR older than a minute says *expired*. A denied camera permission still leaves the manual field working.
- `select * from checkins order by created_at desc limit 5;` shows the rows — nothing in the app displays them, by design.
- Push, on **Android and iPhone**, PWA installed (from Safari on iOS), app closed: a notification arrives for a new message, for an appointment status change, and for a newly assigned plan; the tap opens the right route; the Settings switch stops them; signing out stops them on that device.

- [ ] **Step 2: Bring `CLAUDE.md` up to date**

Its "What this is" section still describes Phase 4A as in progress. State that 4A is merged and 4B is this branch, and add `node src/features/profile/pushSubscription.selfcheck.js` to the self-check list, which says "There are eight".

- [ ] **Step 3: Verify the whole phase**

`npm run lint`, `npm run build`, the nine self-checks, and `supabase/verify.sql` — its three security rows and two grant rows must still read PASS, and its four seed-count rows still read FAIL by design.

Confirm no `<Placeholder />` remains:

```bash
grep -n "screen('" src/routes/index.jsx
```

Expected: no matches, or only the `screen` helper's own definition. If the helper is now unused, delete it.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/2026-07-30-device-verification.md CLAUDE.md src/routes/index.jsx
git commit -m "docs: record the Phase 4B acceptance checks"
```

---

## Deferred beyond this phase

- A check-in history view for either role. `checkins` is written and read by nothing.
- Gym opening hours, which no table holds.
- Notification preferences finer than one switch.
- Editing your own profile, deferred from 4A.
- Enforcing the professional's availability when booking, deferred from 4A.
- A scheduled `delete from checkin_tokens where expires_at < now() - interval '1 day'`. The rows are tiny and the index is there; a cron job is ceremony until it is not.
