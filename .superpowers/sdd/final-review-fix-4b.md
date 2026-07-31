# Phase 4B whole-branch review — fixes

Branch `phase-4b-badge-scanner-and-push`, on top of `a5dad75`. Four commits,
eight fixes.

| SHA | Subject |
|-----|---------|
| `e8ef5da` | fix(push): stop notify_user being a public RPC and clamp the tap target |
| `909c0ce` | fix(db): bump verify.sql for the two tables Phase 4B adds |
| `44f357e` | fix(db): harden the three oldest security definer functions |
| `538e63c` | fix(badge,push): recover the badge error state, stop clock-skew re-minting, unsubscribe offline |

---

## FIX 1 (Critical) — `notify_user` was a public RPC

**a. `supabase/patches/010-push-notifications.sql:79-98`** — a comment block
explaining the exposure, then:

```sql
revoke execute on function public.notify_user(uuid,text,text,text)
  from public, anon, authenticated;
```

All three roles have to be named: Postgres grants `EXECUTE` to `PUBLIC` on every
new function, and `patches/006` adds explicit grants plus default privileges for
`anon` and `authenticated`, so revoking only the app roles would leave the
`PUBLIC` grant standing.

New PASS row at `010-push-notifications.sql:212-215`, with the reason for it at
`:194-197` (re-running `patches/006` after this file undoes the revoke — replay
010 after it, same ordering hazard `patches/008` documents).

**Do the four trigger functions need the same revoke? No.** Two independent
reasons, either sufficient:

1. **PostgREST does not expose them.** Its schema cache selects candidate RPCs
   from `pg_proc` and excludes anything whose return type is `trigger`
   (`pg_type.typname = 'trigger'`, oid 2279), because such a function has no
   callable argument list. `POST /rest/v1/rpc/notify_on_message` answers
   `PGRST202 — could not find the function in the schema cache`, not `403`.
2. **Postgres refuses the call anyway.** Invoking a `returns trigger` function
   outside a trigger context raises `0A000 — trigger functions can only be
   called as triggers`. There is no SQL spelling of the call that works.

Revoking their `EXECUTE` would also be the wrong move: `for each row execute
function` checks the invoking user's `EXECUTE` privilege on the trigger
function, so the revoke would break every insert into `messages`,
`appointments`, `workout_plans` and `nutrition_plans` for the app role.

The triggers still reach `notify_user()` through the revoke because a
`security definer` function runs as its owner, and the owner keeps `EXECUTE`
(revoking from `public`/`anon`/`authenticated` never touches the owner's ACL
entry). That is what makes the fix safe: it closes the browser's door without
touching the database's own path.

**b. `src/sw.js:57-83`.** `notificationclick` now resolves the payload URL
against `self.location.origin` inside a `try`, keeps it only when
`candidate.origin === self.location.origin`, and falls back to `/` otherwise —
`clients.openWindow` is not scope-restricted, so an absolute URL in a forged
payload could open an attacker's page under TrainHub's icon. Window matching is
now `new URL(client.url).pathname === target.pathname`; `String.includes` matched
*every* open window whenever the target was `/`, so a home-screen notification
focused whatever tab happened to be first.

## FIX 2 (Important) — `verify.sql` against 18 tables

`supabase/verify.sql:22-56`. Counts bumped: public tables `16 → 18`, RLS enabled
`16 → 18`, at least one policy `16 → 17`, app role can read `16 → 17`, app role
can write `16 → 17`. Seed rows untouched.

The comment at `:31-40` says why the last three are 17 and not 18: `app_config`
holds the secret authenticating the database to the Edge Function and is
deliberately policy-less *and* grant-less, so RLS-with-no-policy denies every
PostgREST caller and the missing grant denies them one gate earlier. **The gap
is the assertion** — if any of those three ever reads 18, that table became
reachable from the browser.

The header at `:7-11` now says the file must run *after* the patches, since its
counts presuppose `009` and `010`.

Reconciled: `CLAUDE.md:169-175` and
`docs/superpowers/2026-07-30-device-verification.md:34-41`. The design spec's
Acceptance section also states the old expectation; left alone per the brief,
and it reads as a historical record of what Phase 0 asserted.

## FIX 3 (Important) — pg_temp shadowing in the definer functions

New `supabase/patches/011-harden-definer-functions.sql` (121 lines):
`create or replace` for `is_professional()`, `owns_member()` and
`handle_new_user()`, all three now `set search_path = ''` with `public.`-qualified
relations. `handle_new_user` also needed `::public.user_role` — the enum is a
`public` type and an empty search path cannot find it unqualified; everything
else in that body (`coalesce`, `new.*`) resolves through `pg_catalog`, which is
searched whatever `search_path` says.

Four PASS rows, each asserting `'search_path=' = any(proconfig)` (the shape
`patches/009` uses), plus one asserting `on_auth_user_created` is still attached
— `create or replace` keeps the OID, so nothing had to be dropped and the
policies referencing the two helpers keep working untouched.

Source files fixed too, the `patches/008` precedent: `supabase/policies.sql:22-46`
and `supabase/schema.sql:209-226`.

**Handoff for Davide — exact instruction:**

> In the Supabase SQL editor, run `supabase/patches/011-harden-definer-functions.sql`
> in full. It is independent of the other patches and can go in at any point
> after `policies.sql`; it does not need `009` or `010`. All four rows of its
> PASS/FAIL block must read PASS — they fail against the current database by
> construction, so a screen of PASS is proof it ran rather than proof it was
> already fine. Nothing needs redeploying afterwards: `create or replace` keeps
> the function OIDs, so every policy and the `on_auth_user_created` trigger
> continue to point at the hardened bodies. Then re-run `supabase/verify.sql`
> and confirm the three security rows and two grant rows still read PASS.
>
> Sanity check that the hole is closed, from a *signed-in member* SQL session
> (or psql as `authenticated` with `request.jwt.claims` set):
> `create temp table profiles (id uuid, role text); insert into profiles values (auth.uid(), 'professional'); select public.is_professional();`
> must answer `false`. Before the patch it answers `true`.

## FIX 4 (Important) — the badge error state recovers

`src/features/profile/BadgeScreen.jsx`:
- `:114` — the `Alert` is replaced by `<ErrorState error={error} onRetry={mint} />`,
  the same idiom every other screen uses. `Alert` is no longer imported (`:2`).
- `:71-79` — an effect that registers `window.addEventListener('online', mint)`
  while `error` is set and removes it on unmount or on recovery. `mint` is the
  `useCallback` every caller already goes through, so the in-flight guard covers
  the listener too.
- `:82` — the countdown effect now returns `undefined` explicitly on the early
  path, for consistent-return with its cleanup branch.

`ErrorState` renders its own offline wording, so the branch's one departure from
the app's error idiom is gone; the retry button and the `online` listener are two
independent ways out of the same state.

## FIX 5 (Important) — clock skew no longer mints in a loop

`src/data/checkin.js:15-33` — `mintCheckinToken` selects
`token, expires_at, created_at` and returns `lifetimeMs`, computed as
`expires_at - created_at`: two *database* timestamps, so the device clock never
enters the number.

`src/features/profile/BadgeScreen.jsx:48-52` stores
`expiresAt: Date.now() + row.lifetimeMs` at the moment the response lands (inside
the async callback, not the render body — `react-hooks/purity`), and `:85`
computes `badge.expiresAt - Date.now()`, now device-clock on both sides of the
subtraction. The visibility gate and the in-flight guard are unchanged.

## FIX 6 (Important) — signing out offline unsubscribes

`src/features/profile/pushSubscription.js:60-83`. The delete is wrapped in `try`
and `subscription.unsubscribe()` moved to `finally`, so the local unsubscribe
happens whether or not the row could be deleted. The doc comment now describes
that ordering and its two reasons — the departed user's notifications, and the
`endpoint`-unique upsert collision that would block the next user of the phone —
plus why the orphaned row is harmless (410 from a dead endpoint, pruned by the
Edge Function).

## FIX 7 (Minor) — `Placeholder.jsx` deleted

`grep -rn Placeholder` over the repo before deleting: **zero** hits in `src/`
other than the file's own definition. Every other hit is prose in
`docs/superpowers/plans/*.md` and the Phase 4B spec, all of it historical (the
Phase 0 plan that introduced it, and later plans recording which routes stopped
being placeholders). The `screen()` helper that constructed it is already gone
from `src/routes/index.jsx`. Deleted; no import to clean up anywhere.

## FIX 8 (Minor) — where a lost notification explains itself

`docs/superpowers/2026-07-30-device-verification.md:255-262`, last item in the
push prerequisites:

```sql
select status_code, content from net._http_response order by created desc limit 10;
```

with a sentence saying `net.http_post` is fire-and-forget, so a 403 from a
mismatched `notify_secret` or a 500 from the Edge Function reaches nothing in the
app and nothing in the checklist — it lands there and only there.

---

## Verification

| Command | Result |
|---------|--------|
| `npm run lint` | exit 0, no output |
| `npm run build` | success — 88 modules, `dist/sw.js` generated, precache 89 entries |
| `node src/lib/format.selfcheck.js` | OK |
| `node src/theme/resolveTokens.selfcheck.js` | OK |
| `node src/features/workout/timer.selfcheck.js` | OK |
| `node src/features/workout/status.selfcheck.js` | OK |
| `node src/features/workout/summary.selfcheck.js` | OK |
| `node src/features/clients/subscription.selfcheck.js` | OK |
| `node src/features/calendar/month.selfcheck.js` | OK |
| `node src/features/progress/progress.selfcheck.js` | OK |
| `node src/features/profile/pushSubscription.selfcheck.js` | OK |

No `eslint-disable` added anywhere. No new dependencies. `.superpowers/sdd/`
stayed out of every commit (`git status` still shows the nine scratch files
modified and unstaged).

---

## Found while fixing, not in the findings

1. **`patches/010` needs the same replay warning `patches/008` carries.**
   `patches/006` grants `execute on all routines` *and* sets default privileges
   for future ones, so re-running 006 after 010 silently re-opens
   `notify_user` — exactly the trap 008 documents for its column revoke. Noted
   in the new comment at `010-push-notifications.sql:194-197`; there is no way to
   make the file self-defending against a later 006.

2. **Adding a `public` function is now a security decision, not a neutral one.**
   Anything non-trigger added to `public` from here on is an RPC endpoint the
   moment it is created, because 006's default privileges grant it before anyone
   thinks about it. `redeem_checkin_token` is correctly public (it self-checks
   `is_professional()`), and after FIX 3 that check is actually trustworthy —
   but the pairing means every future definer function has to answer both "is it
   meant to be callable?" and "does it check the caller?".

3. **FIX 3 partly invalidates a `patches/009` PASS row's meaning.**
   `009`'s "redeem runs with an empty search path" reads PASS today, and did
   while the function was still gated by a shadowable `is_professional()`. The
   row was true and the property it implied was false. `011`'s rows are what make
   it mean what it claims.

4. **The badge's checklist item for offline is now slightly wrong.** Section 9
   says the offline badge "says something about needing a connection" — it now
   renders `ErrorState`'s "You are offline / This screen needs data we have not
   cached yet", with a Retry button, and it self-heals on reconnect without a
   navigation. The item still passes as written; a device tester should expect
   the new wording and the extra recovery.

5. **`net._http_response` is only readable by a privileged role.** The FIX 8
   query works in the Supabase SQL editor (which runs privileged) and nowhere
   else — no app path can surface it. That is the right place for it, but it does
   mean push debugging is dashboard-only.

6. **Not touched, deliberately:** the design spec's Acceptance section still
   states the pre-Phase-4B `verify.sql` expectation. The brief named two
   documents to reconcile and the spec is a dated record of a decision rather
   than a live checklist, so bumping it would rewrite history rather than fix a
   stale instruction.

---

# Second round — last review pass before merge

On top of `538e63c`. Six edits, four SQL PASS-row/comment fixes and two client
fixes, plus one doc fix.

## EDIT 1 (Important) — search-path PASS rows asserted the wrong literal

`search_path` carries `GUC_LIST_QUOTE`: the value Postgres stores for
`set search_path = ''` passes through `quote_identifier()` first, so the
`proconfig` element for an empty path is `search_path=""`, not `search_path=`.
All four PASS rows were asserting the un-quoted spelling and would read FAIL
against a database that was patched correctly — a false negative nobody had
hit yet because none of these patches has been run.

- `supabase/patches/011-harden-definer-functions.sql:87-98` (comment,
  rewritten to explain the overlap and the quoting) and `:107-121` (three
  rows: `is_professional`, `owns_member`, `handle_new_user`) — each
  `('search_path=' = any(p.proconfig))::text` became
  `(p.proconfig && array['search_path=', 'search_path=""'])::text`.
- `supabase/patches/009-checkin-tokens.sql:137-144` (the `redeem runs with an
  empty search path` row) — same rewrite, plus a new comment on the row
  explaining the quoting, since the file had none before.

Chose array overlap (`&&`) over `like 'search_path=%'` per the brief: `like`
would also match `search_path=public`, destroying the assertion that the path
is empty rather than merely present.

Final text of one rewritten row (`011-harden-definer-functions.sql:107-111`):

```sql
    ('is_professional runs with an empty search path',
     (select (p.proconfig && array['search_path=', 'search_path=""'])::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_professional'),
     'true'),
```

## EDIT 2 (Minor) — the revoke assertion covered only `authenticated`

`supabase/patches/010-push-notifications.sql:212-217`. The revoke at `:96-97`
already names `public, anon, authenticated`, but the PASS row only checked
`authenticated`. Extended to `and not has_function_privilege('anon', ...)` —
`anon` is the role the publishable key carries with no session, the exact path
the finding described. Comment above the row (`:191-197`) updated to say both
roles are asserted because the revoke names both.

## EDIT 3 (Minor) — the revoke's comment read as an exhaustive grantee list

`supabase/patches/010-push-notifications.sql:88-96`. `patches/006` also grants
execute to `service_role`, and this revoke deliberately leaves that grant
standing — the service key never reaches a browser, so there's no forgery path
through it. The comment named `public`, `anon` and `authenticated` as though
that were the complete set of grantees; added a sentence saying `service_role`
is a fourth grant, left alone on purpose, so the next reader doesn't "complete"
the revoke by adding it.

## EDIT 4 (Minor) — notification tap opened a second window

`src/sw.js:71-83`. The pathname-equality matcher (itself a fix from the first
review round) missed the common case: the app open on `/m` doesn't equal a
chat notification's `/m/trainer/chat`, so no window matched and a second one
opened. Replaced with: take any open window, `client.navigate(url)` then
`client.focus()` on the result (falling back to the pre-navigate client if
`navigate` resolves `null`), and only `openWindow` when there is no window at
all. The same-origin clamp above it (`:60-69`) is untouched.

## EDIT 5 (Minor) — `disablePush`'s import sat outside its own `try`

`src/features/profile/pushSubscription.js:74-83`. The dynamic
`await import('../../data/push.js')` was a statement above the `try`, so a
rejected import (module fetch failure, offline included) skipped the `finally`
and left the device still subscribed — exactly the failure the `finally` exists
to prevent. Moved the import to the first line inside `try`; `finally` now
covers both the import and the delete call.

## EDIT 6 (Minor) — checklist didn't exercise the badge's new error state

`docs/superpowers/2026-07-30-device-verification.md`, the **Badge offline**
item in section 9. Verified against `src/features/profile/BadgeScreen.jsx:114`
(`<ErrorState error={error} onRetry={mint} />`) and `:75-79` (an `online`
listener that calls `mint` again while `error` is set, no navigation needed).
Rewrote the item to check: the standard `ErrorState` with Retry renders, Retry
while still offline fails again into the same state, and reconnecting without
touching anything re-mints the badge on its own.

## Verification, second round

| Command | Result |
|---------|--------|
| `npm run lint` | exit 0, no output |
| `npm run build` | success — `dist/sw.js` generated, precache 89 entries |
| `node src/lib/format.selfcheck.js` | OK |
| `node src/theme/resolveTokens.selfcheck.js` | OK |
| `node src/features/workout/timer.selfcheck.js` | OK |
| `node src/features/workout/status.selfcheck.js` | OK |
| `node src/features/workout/summary.selfcheck.js` | OK |
| `node src/features/clients/subscription.selfcheck.js` | OK |
| `node src/features/calendar/month.selfcheck.js` | OK |
| `node src/features/progress/progress.selfcheck.js` | OK |
| `node src/features/profile/pushSubscription.selfcheck.js` | OK |

No `eslint-disable` added. No new dependencies. `.superpowers/sdd/` scratch
kept out of both commits.
