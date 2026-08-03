# Task 4 Report: Push Notifications Database Half

## What Was Implemented

Created `supabase/patches/010-push-notifications.sql` with:

1. **pg_net extension** — for async HTTP POST to the Edge Function
2. **app_config table** — private configuration (RLS enabled, grants revoked) holding `notify_function_url` and `notify_secret`
3. **notify_user(uuid, text, text, text)** function — security definer, calls Edge Function via net.http_post, gracefully handles missing config or HTTP failure
4. **Four trigger functions:**
   - `notify_on_message()` — fires after INSERT on messages, notifies the OTHER party in the thread
   - `notify_on_appointment_status()` — fires after UPDATE of status on appointments, notifies member
   - `notify_on_workout_plan()` — fires after INSERT on workout_plans, notifies member
   - `notify_on_nutrition_plan()` — fires after INSERT on nutrition_plans, notifies member
5. **PASS/FAIL verification block** — confirms pg_net installed, function exists, all four triggers exist, app_config unreadable by authenticated role

## Column Names Verified Against supabase/schema.sql

Checked the brief's references and confirmed:
- `threads` has: id, member_id, pro_id, created_at ✓
- `messages` has: id, thread_id, sender_id, body, read_at, created_at ✓
- `appointments` has: member_id, status, starts_at ✓
- `workout_plans` has: member_id, name ✓
- `nutrition_plans` has: member_id, name ✓
- `profiles` has: id, full_name ✓
- `push_subscriptions` already exists (id, user_id, endpoint, p256dh, auth, created_at) ✓

All references in the patch match existing schema columns exactly.

## Verification Results

**npm run lint:**
```
> trainhub@0.0.0 lint
> eslint .

[exit 0 — no errors]
```

**npm run build:**
```
> trainhub@0.0.0 build
> vite build

✓ 1209 modules transformed.
...
✓ built in 557ms

PWA v1.3.0
Building src/sw.js service worker ("es" format)...
...
✓ built in 52ms

PWA v1.3.0
mode      injectManifest
format:   es
precache  87 entries (1296.31 KiB)
files generated
  dist/sw.js
```

Both gates passed.

## Handoff Note (Verbatim from Brief)

Run `supabase/patches/010-push-notifications.sql`. All four rows must read PASS. Then insert the two configuration values **by hand** — they are secrets and must never be committed:

```sql
insert into app_config (key, value) values
  ('notify_function_url', 'https://<project-ref>.supabase.co/functions/v1/notify'),
  ('notify_secret',       '<the shared secret you generated>')
on conflict (key) do update set value = excluded.value;
```

Until those rows exist, `notify_user` returns quietly and nothing else in the app is affected — that is deliberate, so the badge and the scanner work on a database where the Edge Function was never deployed.

## Self-Review: Security Boundaries

**Every function declares security definer + set search_path = '':**
- `notify_user()` — line 48, 49 ✓
- `notify_on_message()` — line 81 ✓
- `notify_on_appointment_status()` — line 110 ✓
- `notify_on_workout_plan()` — line 132 ✓
- `notify_on_nutrition_plan()` — line 145 ✓

**All relations fully schema-qualified:**
- `public.app_config` — lines 55, 56 ✓
- `public.threads` — lines 88, 96 ✓
- `public.profiles` — line 90 ✓
- `public.notify_user()` — lines 92, 116, 134, 147, 166 ✓
- `net.http_post` — line 64 (schema-qualified extension function) ✓

**Built-ins unqualified (correct):**
- `jsonb_build_object()`, `left()`, `coalesce()`, `to_char()`, `is not distinct from`, `sqlerrm` — all pg_catalog, need no qualification ✓

**PASS/FAIL block accuracy:**
- `pg_net installed` — selects from pg_extension, counts = 1 ✓
- `notify_user exists` — uses to_regprocedure with exact signature ✓
- `four triggers` — looks for all four by name in pg_trigger ✓
- `config unreadable by the app role` — the critical one: verifies authenticated role has NO select privilege on app_config ✓

**Idempotency:**
- `create extension if not exists` ✓
- `create table if not exists` ✓
- `create or replace function` (5 times) ✓
- `drop trigger if exists ... create trigger` (4 times) ✓

## Commit

Created: `98a6f94 feat(push): raise notifications from the database`

## Issues or Concerns

None. The patch is ready for hand application by Davide.

---

## Addendum: Critical Bug Fix on Phase 4B

**Finding:** The four trigger functions (`notify_on_message`, `notify_on_appointment_status`, `notify_on_workout_plan`, `notify_on_nutrition_plan`) lacked exception handlers. Any failure during their setup phase — a lookup failure in `public.threads` or `public.profiles`, a type error, anything — would propagate out of the trigger and **abort the INSERT or UPDATE that fired it**. This directly violated the patch's opening invariant: "a lost notification is an annoyance, a lost message is a bug."

Example: A message INSERT fails because a `threads` lookup raises an exception. The message is lost.

**Fix:** Added exception handlers to all four trigger functions, matching the pattern already in `notify_user()`. Each handler:
1. Catches all exceptions with `exception when others then`
2. Raises a warning naming the trigger and the error via `sqlerrm`
3. Returns null to allow the triggering statement to proceed

**One of the four trigger functions after fix (notify_on_message):**
```sql
create or replace function notify_on_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_target uuid;
  v_sender text;
begin
  select case when t.member_id = new.sender_id then t.pro_id else t.member_id end
  into v_target
  from public.threads t where t.id = new.thread_id;

  select full_name into v_sender from public.profiles where id = new.sender_id;

  perform public.notify_user(
    v_target,
    coalesce(v_sender, 'New message'),
    left(new.body, 120),
    case when v_target = (select member_id from public.threads where id = new.thread_id)
         then '/m/trainer/chat'
         else '/p/chat/' || new.thread_id::text
    end);
  return null;
exception when others then
  raise warning 'notify_on_message failed: %', sqlerrm;
  return null;
end $$;
```

**What each handler now catches:**
- `notify_on_message`: Thread lookup, profile lookup, or any error before calling `notify_user()`
- `notify_on_appointment_status`: Any error after the status-change guard, before calling `notify_user()`
- `notify_on_workout_plan`: Any error during the `notify_user()` call or plan-name access
- `notify_on_nutrition_plan`: Any error during the `notify_user()` call or plan-name access

**Security and idempotency preserved:**
- All functions remain `security definer` with `set search_path = ''`
- All relations remain fully schema-qualified
- Trigger names, timing (`after insert`, `after update of status`), and `for each row` semantics unchanged
- Early return in `notify_on_appointment_status` (status equality check) preserved
- Patch remains idempotent (`create or replace`, `create if not exists`, `drop if exists`)
- PASS/FAIL verification block unchanged

**Verification:**
```
npm run lint
> trainhub@0.0.0 lint
> eslint .
[exit 0]

npm run build
> trainhub@0.0.0 build
> vite build
✓ 1209 modules transformed.
...
✓ built in 576ms
...
✓ built in 57ms
```

Both gates passed.

**Commit:** `50df01d fix(db): add exception handlers to notification triggers`
