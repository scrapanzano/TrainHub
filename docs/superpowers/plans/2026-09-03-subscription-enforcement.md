# Subscription Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `subscription_status` / `subscription_until` gate real behaviour (booking, plan creation, reward points) and give the professional a button to move a client between `active` and `suspended`.

**Architecture:** One new SQL patch adds a `has_active_subscription(member_id)` predicate and a professional-only `set_subscription_status_secure` RPC, and threads the predicate into four existing secure RPCs. The client mirrors the predicate in `subscription.js` for pre-emptive UI (banner, disabled CTAs) while the RPCs stay the real boundary.

**Tech Stack:** React 19 + Vite, MUI v9, TanStack Query v5, Supabase Postgres RPC (`security definer`), plain JS (no TS), `node`-run `*.selfcheck.js` (no test runner).

## Global Constraints

- `npm run lint` **and** `npm run build` must both pass — lint never resolves module paths, Vite does. MUI icon glyphs: only the `*Outlined` variants exist in `@mui/icons-material@9.2.0`.
- No TypeScript. ESM (`"type": "module"`). No CSS files, no colour literals — style through the theme; `palette.task.*` exists for kind colours.
- No `eslint-disable`, ever. No `Date.now()` / `crypto.randomUUID()` in a render body (`react-hooks/purity`); no `ref.current` writes during render (`react-hooks/refs`).
- Gate a read's error UI on `data === undefined`, never `isError` alone.
- Every Supabase **read** carries `.retry(navigator.onLine)`. **Writes must not.**
- Every write is registered in `src/data/mutations.js` via `setMutationDefaults`; the call site must **not** pass `onSettled` to `useMutation` (per-call `mutate(vars, { onSuccess })` is fine).
- A write whose order matters needs a `scope` on its registered default.
- SQL: every `security definer` function is `set search_path = ''` and fully `public.`-qualified. `create or replace function` preserves existing GRANTs. Patches are hand-applied by Davide and carry their own PASS/FAIL block.
- Commit per task, Conventional Commits. **Davide's explicit instruction: commits in his name only — NO `Co-Authored-By` trailer, NO `Claude-Session` trailer, no AI attribution of any kind.** Plain subject line + body. Stage only the files each task names. **Never** `git add` anything under `.superpowers/sdd/`.
- Demo accounts: `daniel@trainhub.dev` (member, assigned to andrea), `andrea@trainhub.dev` (professional). `supabase/patches/005-demo-clients.sql` seeds one `suspended` and one `expired` demo client.

---

### Task 1: SQL patch `023-subscription-enforcement.sql`

**Files:**
- Create: `supabase/patches/023-subscription-enforcement.sql`
- Modify: `CLAUDE.md` (patch-list sentence in the Database section)

**Interfaces:**
- Produces (SQL, callable from the client via `supabase.rpc`):
  - `public.has_active_subscription(p_member_id uuid) returns boolean`
  - `public.set_subscription_status_secure(p_member_id uuid, p_status public.subscription_status) returns setof public.profiles`
- Produces (behaviour change, no signature change): `close_workout_run_secure`, `create_workout_plan_secure` (8-arg), `create_nutrition_plan_secure` (10-arg), `create_appointment_secure` now reject / skip when the member is not active.

- [ ] **Step 1: Scaffold the patch file with the header and the two new functions**

Create `supabase/patches/023-subscription-enforcement.sql`:

```sql
-- Patch 023 -- give subscription_status / subscription_until real teeth.
--
-- Until now these two columns drove exactly one thing: redeem_checkin_token
-- refuses a badge scan for a suspended / expired / date-elapsed member
-- (patches/015). Everywhere else the state was decorative -- a suspended
-- member still booked sessions and earned reward points, and a professional
-- could still build them a plan.
--
-- This patch:
--   1. adds public.has_active_subscription(member) -- the boolean twin of the
--      redeem_checkin_token CASE, so the rule lives in one place;
--   2. adds public.set_subscription_status_secure(member, status) -- the
--      professional-side button's write. An explicit SIMULATION of the gym's
--      billing server confirming payment; a real deployment would not let a
--      trainer flip this;
--   3. threads has_active_subscription() into close_workout_run_secure (no
--      reward row while inactive), create_workout_plan_secure,
--      create_nutrition_plan_secure and the member-initiated branch of
--      create_appointment_secure.
--
-- ORDERING: re-creates functions first defined in patches/015, 018 and 022,
-- so it MUST be applied after all three. Idempotent: every statement is
-- create-or-replace. `create or replace function` keeps each function's OID
-- and its existing GRANTs, so the four re-created operations stay locked to
-- `authenticated` exactly as their original patches left them.

begin;

-- 1. The shared predicate. ---------------------------------------------------
-- ponytail: redeem_checkin_token keeps its own inline CASE -- it needs the
-- granular 'suspended' vs 'expired' string for the scanner message, not a
-- boolean. Deliberate twin, same rule: suspended/expired always fail; an
-- elapsed subscription_until fails even while the status column still says
-- 'active' (nothing sweeps it).
create or replace function public.has_active_subscription(p_member_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_member_id
      and p.subscription_status not in ('suspended', 'expired')
      and (p.subscription_until is null or p.subscription_until >= current_date)
  );
$$;

grant execute on function public.has_active_subscription(uuid) to authenticated;

-- 2. The professional-side status write. ------------------------------------
create or replace function public.set_subscription_status_secure(
  p_member_id uuid, p_status public.subscription_status
) returns setof public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.profiles%rowtype;
begin
  if not (public.is_professional() and public.owns_member(p_member_id)) then
    raise exception 'not authorized to manage this membership'
      using errcode = '42501';
  end if;

  -- 'expired' is a system state (an elapsed date), never something the button
  -- sets. The button only ever sends 'active' or 'suspended'.
  if p_status not in ('active', 'suspended') then
    raise exception 'membership status must be active or suspended'
      using errcode = '22023';
  end if;

  update public.profiles p
  set subscription_status = p_status,
      -- Reactivating a lapsed or open-ended-but-past membership grants a fresh
      -- year. Suspending, or reactivating one still in date, leaves it alone.
      subscription_until = case
        when p_status = 'active'
          and (p.subscription_until is null or p.subscription_until < current_date)
        then (current_date + interval '12 months')::date
        else p.subscription_until
      end
  where p.id = p_member_id and p.role = 'member'
  returning * into v_row;

  if not found then
    raise exception 'member not found' using errcode = '42501';
  end if;

  return next v_row;
end;
$$;

grant execute on function
  public.set_subscription_status_secure(uuid, public.subscription_status)
  to authenticated;
```

- [ ] **Step 2: Add `close_workout_run_secure` with the reward guard**

Open `supabase/patches/015-essential-security.sql`, find
`create or replace function public.close_workout_run_secure(` and copy the
**entire** function verbatim (from `create or replace` through the closing
`$$;`) into `023` after the block from Step 1.

Then make exactly one change to that copy — the reward-insert guard. Find:

```sql
  if v_points > 0 then
    insert into public.rewards (
```

and change the first line to:

```sql
  if v_points > 0 and public.has_active_subscription(v_row.member_id) then
    insert into public.rewards (
```

Add a comment line directly above it:

```sql
  -- No reward row while the membership is inactive; the run still records
  -- pct / outcome. (patches/023)
```

- [ ] **Step 3: Add `create_workout_plan_secure` with the creation guard**

Open `supabase/patches/018-multi-session-plan-creation.sql`, find
`create or replace function public.create_workout_plan_secure(` (the 8-argument
version, params ending `p_sessions jsonb`) and copy the **entire** function
verbatim into `023`.

Then insert this block immediately **after** the existing authorization check
— the check that ends:

```sql
  if not found or not public.owns_member(p_member_id) then
    raise exception 'not authorized to create this plan for this member'
      using errcode = '42501';
  end if;
```

Insert directly below that `end if;`:

```sql

  -- A plan for a lapsed member helps nobody; the member also cannot train
  -- against it (check-in is refused). Applies whoever the author is. (patches/023)
  if not public.has_active_subscription(p_member_id) then
    raise exception 'member subscription is not active' using errcode = '42501';
  end if;
```

Do **not** copy patch 018's trailing `revoke execute … / grant execute …`
statements — `create or replace` keeps the existing grant.

- [ ] **Step 4: Add `create_nutrition_plan_secure` with the creation guard**

Open `supabase/patches/022-nutrition-day-types.sql`, find
`create or replace function public.create_nutrition_plan_secure(` (10-argument
version, params ending `p_days jsonb`) and copy the **entire** function
verbatim into `023`.

Then insert this block immediately **after** the existing authorization check
— the check that ends:

```sql
  if not found or not public.is_professional() then
    raise exception 'only the assigned professional may create this plan'
      using errcode = '42501';
  end if;
```

Insert directly below that `end if;`:

```sql

  -- Same rule as workout plans: no plan for a lapsed member. (patches/023)
  if not public.has_active_subscription(p_member_id) then
    raise exception 'member subscription is not active' using errcode = '42501';
  end if;
```

Do **not** copy patch 022's trailing `revoke` / `grant` / `drop policy`
statements.

- [ ] **Step 5: Add `create_appointment_secure` with the member-branch guard**

Open `supabase/patches/015-essential-security.sql`, find
`create or replace function public.create_appointment_secure(` and copy the
**entire** function verbatim into `023`.

Then find this branch:

```sql
  if v_actor = p_member_id then
    v_status := 'pending';
  elsif v_actor = p_pro_id then
```

and change it to:

```sql
  if v_actor = p_member_id then
    -- A member cannot request a booking while inactive. A professional still
    -- can, on the member's behalf (a comeback session). (patches/023)
    if not public.has_active_subscription(p_member_id) then
      raise exception 'your subscription is not active' using errcode = '42501';
    end if;
    v_status := 'pending';
  elsif v_actor = p_pro_id then
```

- [ ] **Step 6: Close the transaction and add the PASS/FAIL block**

Append to `023`:

```sql
commit;

-- PASS/FAIL ---------------------------------------------------------------------
-- Run after the commit. Every row must read PASS. The two subscription-state
-- rows lean on patches/005-demo-clients.sql having been applied (it seeds one
-- suspended and one expired demo client); without 005 only those two read FAIL.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end as status
from (
  values
    ('has_active_subscription true for an in-date active member',
     (select public.has_active_subscription(id)::text from public.profiles
      where role = 'member' and subscription_status = 'active'
        and (subscription_until is null or subscription_until >= current_date)
      order by id limit 1),
     'true'),
    ('has_active_subscription false for the suspended demo client',
     (select public.has_active_subscription(id)::text from public.profiles
      where role = 'member' and subscription_status = 'suspended'
      order by id limit 1),
     'false'),
    ('has_active_subscription false for the expired demo client',
     (select public.has_active_subscription(id)::text from public.profiles
      where role = 'member' and subscription_status = 'expired'
      order by id limit 1),
     'false'),
    ('set_subscription_status_secure exists with (uuid, subscription_status)',
     (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'set_subscription_status_secure'
        and pg_get_function_identity_arguments(p.oid)
            = 'p_member_id uuid, p_status subscription_status'),
     '1'),
    ('only authenticated may set membership status',
     has_function_privilege('anon',
       'public.set_subscription_status_secure(uuid, subscription_status)',
       'execute')::text,
     'false'),
    ('the four gated RPCs still exist and stay hardened',
     (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'close_workout_run_secure', 'create_workout_plan_secure',
        'create_nutrition_plan_secure', 'create_appointment_secure')
        and p.prosecdef
        and coalesce(p.proconfig && array['search_path=', 'search_path=""'], false)),
     '4'),
    ('each gated RPC calls has_active_subscription',
     (select count(*)::text from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (
        'close_workout_run_secure', 'create_workout_plan_secure',
        'create_nutrition_plan_secure', 'create_appointment_secure')
        and pg_get_functiondef(p.oid) like '%has_active_subscription%'),
     '4')
) as t(check_name, actual, expected);
```

- [ ] **Step 7: Sanity-check the assembled file**

Read `023` top to bottom. Confirm:
- one `begin;` and one `commit;`, PASS/FAIL block after `commit;`
- six `create or replace function` (2 new + 4 re-created)
- each of the 4 re-created bodies contains exactly one added
  `has_active_subscription` call, everything else byte-identical to its source
- every function is `security definer` + `set search_path = ''`
- no `revoke` / `grant` / `drop policy` copied in from 015/018/022 except the
  two `grant execute` for the new functions

- [ ] **Step 8: Update the patch list in `CLAUDE.md`**

In `CLAUDE.md`, Database section, the `patches/001`…`022` bullet: change the
range to `patches/001`…`023`, and before the closing sentence "All must be
applied, in order, before the current branch's code will work…" insert:

```
`023` gives `subscription_status`/`subscription_until` real teeth — a
`has_active_subscription()` predicate plus a professional-only
`set_subscription_status_secure` RPC, wired into plan creation, booking and
reward points.
```

- [ ] **Step 9: Commit**

```bash
git add supabase/patches/023-subscription-enforcement.sql CLAUDE.md
git commit -m "feat(subscription): patch 023 — enforce membership status server-side"
```

- [ ] **Step 10: Hand off to Davide**

In the task report, state that `patches/023` must be applied by Davide in the
Supabase SQL editor **after 015/018/022**, PASS/FAIL block run, every row PASS.
Until then the later tasks build and lint but `set_subscription_status_secure`
404s at runtime.

---

### Task 2: Pure predicate + button-action mapping in `subscription.js`

**Files:**
- Modify: `src/features/clients/subscription.js`
- Modify: `src/features/clients/subscription.selfcheck.js`

**Interfaces:**
- Consumes: existing `subscriptionStateOf(profile, todayISO)` → `{ label, color }`, `daysBetween(fromISO, toISO)`.
- Produces:
  - `isSubscriptionActive(profile, todayISO)` → `boolean` — `false` for null profile, `suspended`, `expired`, or an elapsed `subscription_until`; `true` otherwise (incl. null date and unknown enum).
  - `membershipAction(state)` → `{ label: string, nextStatus: 'active' | 'suspended' } | null`, `state` being a `subscriptionStateOf` result.

- [ ] **Step 1: Add the failing self-check cases**

In `src/features/clients/subscription.selfcheck.js`, change the import line:

```js
import { isSubscriptionActive, membershipAction, subscriptionStateOf } from './subscription.js'
```

and append before the final `console.log`:

```js
// --- isSubscriptionActive: the boolean twin of the SQL has_active_subscription
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: '2027-03-31' }, TODAY),
  true,
)
// Close to expiring is still active.
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: '2026-08-20' }, TODAY),
  true,
)
// Elapsed date fails even while the column still says active.
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: '2026-07-28' }, TODAY),
  false,
)
assert.equal(
  isSubscriptionActive({ subscription_status: 'suspended', subscription_until: '2027-01-01' }, TODAY),
  false,
)
assert.equal(
  isSubscriptionActive({ subscription_status: 'expired', subscription_until: '2027-01-01' }, TODAY),
  false,
)
// Open-ended membership and unknown enum are both active; missing profile is not.
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: null }, TODAY),
  true,
)
assert.equal(
  isSubscriptionActive({ subscription_status: 'trialling', subscription_until: null }, TODAY),
  true,
)
assert.equal(isSubscriptionActive(null, TODAY), false)

// --- membershipAction: maps a subscriptionStateOf result to the PT button
const suspend = { label: 'Suspend membership', nextStatus: 'suspended' }
const reactivate = { label: 'Reactivate membership', nextStatus: 'active' }
assert.deepEqual(membershipAction({ label: 'Active', color: 'success.main' }), suspend)
assert.deepEqual(membershipAction({ label: 'Close to Expiring', color: 'warning.main' }), suspend)
assert.deepEqual(membershipAction({ label: 'Suspended', color: 'task.suspended' }), reactivate)
assert.deepEqual(membershipAction({ label: 'Expired', color: 'error.main' }), reactivate)
assert.equal(membershipAction({ label: 'Unknown', color: 'task.suspended' }), null)
```

- [ ] **Step 2: Run to verify it fails**

Run: `node src/features/clients/subscription.selfcheck.js`
Expected: FAIL — `TypeError: isSubscriptionActive is not a function`.

- [ ] **Step 3: Implement the two exports**

In `src/features/clients/subscription.js`, append after `subscriptionStateOf`:

```js
/**
 * Whether the member may currently use paid features -- the JS twin of the SQL
 * `has_active_subscription(member)` from patches/023. Same rule as
 * `subscriptionStateOf`: `suspended` and `expired` always fail, and an elapsed
 * `subscription_until` fails even while the status column still says 'active'.
 *
 * Pre-emptive UI only (the shell banner, disabled CTAs). The RPCs are the real
 * boundary.
 */
export function isSubscriptionActive(profile, todayISO) {
  if (!profile) return false
  if (profile.subscription_status === 'suspended') return false
  if (profile.subscription_status === 'expired') return false
  const until = profile.subscription_until
  if (!until) return true
  return daysBetween(todayISO, until) >= 0
}

/**
 * The professional's one context-aware membership button, given a
 * `subscriptionStateOf` result. `null` hides the button (Unknown state -- the
 * client row has not loaded, or has no status we can act on).
 */
export function membershipAction(state) {
  if (state.label === 'Suspended' || state.label === 'Expired') {
    return { label: 'Reactivate membership', nextStatus: 'active' }
  }
  if (state.label === 'Active' || state.label === 'Close to Expiring') {
    return { label: 'Suspend membership', nextStatus: 'suspended' }
  }
  return null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node src/features/clients/subscription.selfcheck.js`
Expected: PASS — prints `subscription.selfcheck OK`.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/clients/subscription.js src/features/clients/subscription.selfcheck.js
git commit -m "feat(subscription): add isSubscriptionActive and membershipAction helpers"
```

---

### Task 3: Client data plumbing for the status write

**Files:**
- Modify: `src/lib/mutationKeys.js`
- Modify: `src/data/clients.js`
- Modify: `src/data/mutations.js`

**Interfaces:**
- Consumes: `supabase` from `../lib/supabase.js`; `queryKeys.client`, `queryPrefixes.clients`; `mutationKeys`.
- Produces:
  - `mutationKeys.setSubscriptionStatus` → `['setSubscriptionStatus']`
  - `setSubscriptionStatus({ memberId, status })` in `src/data/clients.js` → resolves to the updated profile row; throws on error. `status` is `'active' | 'suspended'`.
  - registered default in `mutations.js`: `mutationFn: setSubscriptionStatus`, `scope: { id: 'subscriptionStatus' }`, `onSettled` invalidates `queryPrefixes.clients` and `queryKeys.client(variables.memberId)`.

- [ ] **Step 1: Add the mutation key**

In `src/lib/mutationKeys.js`, after `setAppointmentStatus: ['setAppointmentStatus'],`:

```js
  setSubscriptionStatus: ['setSubscriptionStatus'],
```

- [ ] **Step 2: Add the data function**

In `src/data/clients.js`, append:

```js
/**
 * Flip a client's membership between 'active' and 'suspended' (patches/023's
 * `set_subscription_status_secure`). A deliberate simulation of the gym's
 * billing server -- the RPC checks `is_professional() and owns_member()`.
 *
 * Reactivating a lapsed membership grants a fresh 12 months server-side; the
 * caller does not pass a date.
 *
 * A write, so no `.retry()`. Registered in `src/data/mutations.js` -- it may
 * pause offline and replay, which is safe: the payload is an absolute-value
 * update keyed by `member_id`, so replaying it is a no-op.
 */
export async function setSubscriptionStatus({ memberId, status }) {
  const { data, error } = await supabase
    .rpc('set_subscription_status_secure', { p_member_id: memberId, p_status: status })
    .single()

  if (error) throw error
  return data
}
```

- [ ] **Step 3: Register the durable default**

In `src/data/mutations.js`:

Add near the other data imports at the top:

```js
import { setSubscriptionStatus } from './clients.js'
```

After the `setAppointmentStatus` `setMutationDefaults` block, add:

```js
  // Flip a client's membership status. Scoped so two rapid toggles
  // (suspend then reactivate) replay in the order they were clicked rather
  // than racing. No client-generated id: the write is an absolute-value
  // UPDATE keyed by member_id, a no-op on replay.
  queryClient.setMutationDefaults(mutationKeys.setSubscriptionStatus, {
    mutationFn: setSubscriptionStatus,
    scope: { id: 'subscriptionStatus' },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.clients })
      queryClient.invalidateQueries({ queryKey: queryKeys.client(variables.memberId) })
    },
  })
```

`queryKeys` and `queryPrefixes` are already imported in this file.

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both clean. (The bootstrap guard at the end of `registerMutationDefaults`
throws `Missing durable mutation defaults: …` at app boot if a key is
unregistered — verified for real in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mutationKeys.js src/data/clients.js src/data/mutations.js
git commit -m "feat(subscription): wire setSubscriptionStatus mutation"
```

---

### Task 4: Professional client-profile membership button

**Files:**
- Modify: `src/features/clients/ClientDetailScreen.jsx`

**Interfaces:**
- Consumes: `membershipAction`, `subscriptionStateOf` from `./subscription.js`; `mutationKeys.setSubscriptionStatus`; `useMutation`.

- [ ] **Step 1: Imports and mutation wiring**

In `src/features/clients/ClientDetailScreen.jsx`:

Add `useState` to the `react` import:

```js
import { useState } from 'react'
```

Change the MUI import to add `Alert`, `Button`, `Snackbar`:

```js
import {
  Alert, Avatar, Box, Button, Card, CardActionArea, CardContent, Chip,
  LinearProgress, Snackbar, Stack, Typography,
} from '@mui/material'
```

Change the subscription import to add `membershipAction`:

```js
import { daysBetween, membershipAction, subscriptionStateOf } from './subscription.js'
```

Change the `@tanstack/react-query` import:

```js
import { useMutation, useQuery } from '@tanstack/react-query'
```

Add the mutation-keys import:

```js
import { mutationKeys } from '../../lib/mutationKeys.js'
```

Inside the component, after the three `useQuery` calls and before the
`if (client.isPending)` guard:

```js
  const [feedback, setFeedback] = useState(null)
  const membership = useMutation({ mutationKey: mutationKeys.setSubscriptionStatus })
```

- [ ] **Step 2: Render the button + feedback beside the State chip**

`state` is computed at line 69. The `State:` chip is the last child of the
Chip `Stack` that closes around line 132. Directly after that `</Stack>`, still
inside the centred identity `Stack`, add:

```jsx
        {(() => {
          const action = membershipAction(state)
          if (!action) return null
          return (
            <Button
              size="small"
              variant="outlined"
              disabled={membership.isPending}
              onClick={() =>
                membership.mutate(
                  { memberId: clientId, status: action.nextStatus },
                  {
                    onSuccess: () =>
                      setFeedback(
                        action.nextStatus === 'active'
                          ? 'Membership reactivated.'
                          : 'Membership suspended.',
                      ),
                  },
                )
              }
            >
              {membership.isPending ? 'Saving…' : action.label}
            </Button>
          )
        })()}
        {membership.isError ? (
          <Alert severity="error" sx={{ width: '100%' }}>
            {membership.error?.message ?? 'The membership could not be updated.'}
          </Alert>
        ) : null}
        <Snackbar
          open={Boolean(feedback)}
          autoHideDuration={4000}
          onClose={() => setFeedback(null)}
          message={feedback ?? ''}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        />
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/clients/ClientDetailScreen.jsx
git commit -m "feat(subscription): membership suspend/reactivate button on client profile"
```

---

### Task 5: Professional plan-creation gates

**Files:**
- Modify: `src/features/clients/ClientWorkoutScreen.jsx`
- Modify: `src/features/nutrition/NutritionPlanEditorScreen.jsx`

**Interfaces:**
- Consumes: `isSubscriptionActive` from `../clients/subscription.js`; `todayISO` from `../../lib/format.js`; the already-loaded `client.data` (`fetchClient`, carries `subscription_status` / `subscription_until`).

- [ ] **Step 1: Gate `ClientWorkoutScreen`**

In `src/features/clients/ClientWorkoutScreen.jsx`:

Add imports (`Alert` is already imported):

```js
import { isSubscriptionActive } from './subscription.js'
import { todayISO } from '../../lib/format.js'
```

After `const clientName = client.data?.full_name ?? 'this client'` (line 39):

```js
  const membershipActive = isSubscriptionActive(client.data, todayISO())
```

Define this once, above the `return` in the component body:

```js
  const inactiveNotice = (
    <Alert severity="warning">
      {clientName}&rsquo;s membership is not active. Reactivate it on their
      profile before building a plan.
    </Alert>
  )
```

In the "no plan yet" branch replace `<CreatePlanFlow …/>` with:

```jsx
        {membershipActive ? (
          <CreatePlanFlow
            memberId={clientId}
            onDone={() => plan.refetch()}
            onAbandon={() => navigate(`/p/clients/${clientId}`)}
          />
        ) : inactiveNotice}
```

In the `replacing` branch replace `<CreatePlanFlow …/>` with:

```jsx
        {membershipActive ? (
          <CreatePlanFlow
            memberId={clientId}
            replacesPlanId={plan.data.plan.id}
            onDone={() => {
              setReplacing(false)
              plan.refetch()
            }}
            onAbandon={() => setReplacing(false)}
          />
        ) : inactiveNotice}
```

Change the "Create replacement plan" `<Button>` and add a notice after it:

```jsx
      <Button
        variant="outlined"
        size="large"
        fullWidth
        disabled={!membershipActive}
        onClick={() => setReplacing(true)}
      >
        Create replacement plan
      </Button>
      {membershipActive ? null : inactiveNotice}
```

- [ ] **Step 2: Gate `NutritionPlanEditorScreen`**

In `src/features/nutrition/NutritionPlanEditorScreen.jsx` (`Alert` already imported):

```js
import { isSubscriptionActive } from '../clients/subscription.js'
import { todayISO } from '../../lib/format.js'
```

After `const clientName = client.data?.full_name ?? 'this client'` (line 37):

```js
  const membershipActive = isSubscriptionActive(client.data, todayISO())
  const inactiveNotice = (
    <Alert severity="warning">
      {clientName}&rsquo;s membership is not active. Reactivate it on their
      profile before writing a plan.
    </Alert>
  )
```

In the `nutrition.data === null` branch replace `<CreateNutritionPlanFlow …/>`:

```jsx
        {membershipActive ? (
          <CreateNutritionPlanFlow
            memberId={clientId}
            onDone={() => nutrition.refetch()}
            onAbandon={() => navigate(`/p/clients/${clientId}`)}
          />
        ) : inactiveNotice}
```

In the `replacing` branch replace `<CreateNutritionPlanFlow …/>`:

```jsx
        {membershipActive ? (
          <CreateNutritionPlanFlow
            memberId={clientId}
            replacesPlanId={plan.id}
            onDone={() => {
              setReplacing(false)
              nutrition.refetch()
            }}
            onAbandon={() => setReplacing(false)}
          />
        ) : inactiveNotice}
```

Change the "Create replacement plan" `<Button>` (line 152) and add a notice:

```jsx
      <Button
        variant="outlined"
        size="large"
        fullWidth
        disabled={!membershipActive}
        onClick={() => setReplacing(true)}
      >
        Create replacement plan
      </Button>
      {membershipActive ? null : inactiveNotice}
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/clients/ClientWorkoutScreen.jsx src/features/nutrition/NutritionPlanEditorScreen.jsx
git commit -m "feat(subscription): block plan creation for inactive clients in the editors"
```

---

### Task 6: Member shell banner

**Files:**
- Create: `src/components/MembershipBanner.jsx`
- Modify: `src/layouts/AppLayout.jsx`

**Interfaces:**
- Consumes: `useAuth` from `../features/auth/useAuth.js`; `subscriptionStateOf` from `../features/clients/subscription.js`; `todayISO` from `../lib/format.js`.
- Produces: `<MembershipBanner />` default export — a full-width status bar, or `null`.

- [ ] **Step 1: Write the component**

Create `src/components/MembershipBanner.jsx`:

```jsx
import { Box, Typography } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import { useAuth } from '../features/auth/useAuth.js'
import { subscriptionStateOf } from '../features/clients/subscription.js'
import { todayISO } from '../lib/format.js'

// Copy per state. `Close to Expiring` is deliberately NOT here -- that stays a
// display-only pill, unchanged by this feature.
const MESSAGE = {
  Suspended:
    'Membership suspended — gym access, booking and rewards are paused. Contact your trainer.',
  Expired:
    'Membership expired — gym access, booking and rewards are paused. Contact your trainer.',
}

/**
 * A persistent bar in the member shell whenever their own subscription is not
 * active. Mounted next to OfflineBanner and styled to match it. Renders null
 * for professionals and for any active/expiring/unknown member.
 */
export default function MembershipBanner() {
  const { profile } = useAuth()
  if (profile?.role !== 'member') return null

  const message = MESSAGE[subscriptionStateOf(profile, todayISO()).label]
  if (!message) return null

  return (
    <Box
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        py: 0.75,
        px: 2,
        bgcolor: 'error.main',
        color: 'error.contrastText',
      }}
    >
      <ErrorOutlineIcon fontSize="small" aria-hidden />
      <Typography variant="body2">{message}</Typography>
    </Box>
  )
}
```

- [ ] **Step 2: Mount it in the shell**

In `src/layouts/AppLayout.jsx`, add the import beside `OfflineBanner` (line 7):

```js
import MembershipBanner from '../components/MembershipBanner.jsx'
```

In the sticky header `Box`, directly after `<OfflineBanner />`:

```jsx
        <OfflineBanner />
        <MembershipBanner />
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both clean — in particular `ErrorOutlineOutlined` resolves at build.

- [ ] **Step 4: Commit**

```bash
git add src/components/MembershipBanner.jsx src/layouts/AppLayout.jsx
git commit -m "feat(subscription): shell banner when the member's membership is inactive"
```

---

### Task 7: Member-facing action gates (booking, rewards, self-authored plan)

**Files:**
- Modify: `src/features/trainer/MemberAppointmentsScreen.jsx`
- Modify: `src/features/trainer/BookingSheet.jsx`
- Modify: `src/features/rewards/RewardsScreen.jsx`
- Modify: `src/features/workout/NewPlanScreen.jsx`

**Interfaces:**
- Consumes: `isSubscriptionActive` from `../clients/subscription.js`; `todayISO` from `../../lib/format.js`; `useAuth().profile`.

- [ ] **Step 1: Gate the booking CTA in `MemberAppointmentsScreen`**

In `src/features/trainer/MemberAppointmentsScreen.jsx` add (`todayISO` already imported):

```js
import { isSubscriptionActive } from '../clients/subscription.js'
```

The booking block (lines 120-141) is `profile?.assigned_pro_id ? (<Card>…) :
(<EmptyState "No professional yet" />)`. Replace that whole ternary with:

```jsx
      {!isSubscriptionActive(profile, todayISO()) ? (
        <EmptyState
          title="Membership not active"
          description="Ask your trainer to reactivate it before booking."
        />
      ) : profile?.assigned_pro_id ? (
        <Card sx={{ borderColor: 'primary.main' }}>
          <CardActionArea onClick={() => setBooking(true)}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <AddIcon color="primary" />
                <Stack>
                  <Typography variant="h3">Book for this day</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Workout or consultation
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ) : (
        <EmptyState
          title="No professional yet"
          description="Choose one from the Trainer tab before booking."
        />
      )}
```

- [ ] **Step 2: Defence-in-depth in `BookingSheet`**

In `src/features/trainer/BookingSheet.jsx` add (`todayISO` already imported):

```js
import { isSubscriptionActive } from '../clients/subscription.js'
```

After `const unavailable = …` (line 59):

```js
  const membershipInactive = !isSubscriptionActive(profile, todayISO())
```

In `onSubmit`, directly after the existing past-time `if (… ) return` (line 68):

```js
    if (membershipInactive) return
```

In the warning block (line 173), change `{isPast ? (` to prepend a branch:

```jsx
        {membershipInactive ? (
          <Alert severity="warning">
            Your membership is not active. Ask your trainer to reactivate it before booking.
          </Alert>
        ) : isPast ? (
          <Alert severity="warning">Choose a future date and time.</Alert>
        ) : unavailable ? (
```

Add `membershipInactive` to the submit button's `disabled` (line 198):

```jsx
          disabled={
            create.isPending || availability.isPending || isPast || unavailable || membershipInactive
          }
```

- [ ] **Step 3: Rewards note in `RewardsScreen`**

In `src/features/rewards/RewardsScreen.jsx`:

Add `Alert` to the existing `@mui/material` import list. Add:

```js
import { isSubscriptionActive } from '../clients/subscription.js'
import { todayISO } from '../../lib/format.js'
```

Change `const { user } = useAuth()` to:

```js
  const { user, profile } = useAuth()
```

Directly after `<PageHeader title="Rewards" … />` (line 36):

```jsx
      {!isSubscriptionActive(profile, todayISO()) ? (
        <Alert severity="info">
          Your membership is not active — you are not earning points right now.
        </Alert>
      ) : null}
```

- [ ] **Step 4: Self-authored plan gate in `NewPlanScreen`**

In `src/features/workout/NewPlanScreen.jsx` (`Alert` already imported):

```js
import { isSubscriptionActive } from '../clients/subscription.js'
import { todayISO } from '../../lib/format.js'
```

Change `const { user } = useAuth()` to `const { user, profile } = useAuth()`.

After the error guard (line 38):

```js
  const membershipActive = isSubscriptionActive(profile, todayISO())
```

Replace `<CreatePlanFlow …/>` (lines 49-56) with:

```jsx
      {membershipActive ? (
        <CreatePlanFlow
          memberId={user.id}
          replacesPlanId={activePlan.data?.plan.id ?? null}
          onDone={() => navigate('/m/workout', { replace: true })}
          onAbandon={() => navigate('/m/workout', { replace: true })}
        />
      ) : (
        <Alert severity="warning">
          Your membership is not active. It needs to be reactivated before you can build a plan.
        </Alert>
      )}
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/trainer/MemberAppointmentsScreen.jsx src/features/trainer/BookingSheet.jsx src/features/rewards/RewardsScreen.jsx src/features/workout/NewPlanScreen.jsx
git commit -m "feat(subscription): gate booking, rewards note and self-authored plan for inactive members"
```

---

### Task 8: Whole-feature verification

**Files:** none modified (verification only; may produce a fix commit).

- [ ] **Step 1: Run every self-check**

```bash
node src/lib/format.selfcheck.js
node src/lib/week.selfcheck.js
node src/theme/resolveTokens.selfcheck.js
node src/features/workout/timer.selfcheck.js
node src/features/workout/status.selfcheck.js
node src/features/workout/summary.selfcheck.js
node src/features/clients/subscription.selfcheck.js
node src/features/calendar/month.selfcheck.js
node src/features/progress/progress.selfcheck.js
node src/features/profile/pushSubscription.selfcheck.js
node src/features/nutrition/contracts.selfcheck.js
```

Expected: every one prints its `… OK` line, no `AssertionError`.

- [ ] **Step 2: Lint**

Run: `npm run lint` — clean.

- [ ] **Step 3: Build**

Run: `npm run build` — `dist/` written, no unresolved-import / missing-glyph errors.

- [ ] **Step 4: RLS probe**

Run: `node supabase/probe-rls.mjs`
Expected: identical to `main` — this branch adds no policies and no table
grants (only `execute` on two functions), and `probe-rls.mjs` inspects table
reads.

- [ ] **Step 5: Manual device pass** (needs Davide to have applied `patches/023`)

`npm run build && npm run preview`, then:

1. Sign in as `andrea@trainhub.dev`. Open the seeded **suspended** demo client
   → `State:` chip reads `Suspended`, button **Reactivate membership**. Click →
   chip flips to `Active`, button to **Suspend membership**. Its Workout and
   Nutrition editors now offer plan creation.
2. Still as andrea, open `daniel@trainhub.dev` → **Suspend membership**.
3. Sign in as `daniel@trainhub.dev`:
   - Red membership banner on every screen.
   - Trainer tab: booking CTA replaced by "Membership not active".
   - Rewards: info alert above the catalogue.
   - Finish a workout → summary shows the run recorded, but Rewards shows **no
     new** earned entry and the point total is unchanged.
   - `/m/workout` empty state → "Your plan" → create form replaced by the warning.
   - Badge still mints; andrea scanning it is refused ("Subscription suspended")
     — unchanged path.
4. As andrea, **Reactivate membership** for daniel. As daniel: banner gone,
   booking works, finishing a workout earns points again.

- [ ] **Step 6: Update the implementation ledger** (not part of any feature commit)

Append an entry to `.superpowers/sdd/progress.md`: the five gated flows, the
new RPC as a simulation, patch 023's ordering requirement, no status-change
history on the professional side. Do **not** `git add` this file — scratch
bookkeeping per `CLAUDE.md`. Leave it in the working tree for Davide.

- [ ] **Step 7: Finish the branch**

Use `superpowers:finishing-a-development-branch` to present merge / PR options.

---

## Self-Review

**Spec coverage:**

| Spec item | Task |
|---|---|
| `has_active_subscription` predicate | 1 (Step 1) |
| `set_subscription_status_secure` RPC (+12mo reactivate rule) | 1 (Step 1) |
| `close_workout_run_secure` reward guard | 1 (Step 2) |
| `create_workout_plan_secure` guard | 1 (Step 3) |
| `create_nutrition_plan_secure` guard | 1 (Step 4) |
| `create_appointment_secure` member-branch guard | 1 (Step 5) |
| patch ordering note in `CLAUDE.md` | 1 (Step 8) |
| `isSubscriptionActive` + selfcheck | 2 |
| `membershipAction` + selfcheck | 2 |
| `setSubscriptionStatus` data fn | 3 |
| `mutationKeys.setSubscriptionStatus` | 3 |
| `mutations.js` registration (scope, invalidation) | 3 |
| PT button on `ClientDetailScreen` | 4 |
| plan-creation gates in the two pro editors | 5 |
| `MembershipBanner` + `AppLayout` mount | 6 |
| booking gate (`MemberAppointmentsScreen` EmptyState) | 7 |
| `BookingSheet` disabled + Alert | 7 |
| `RewardsScreen` info alert | 7 |
| `NewPlanScreen` gate | 7 |
| lint + build + selfchecks + probe-rls | 8 |
| manual end-to-end both accounts | 8 |

No spec item is unassigned.

**Placeholder scan:** every code step carries full code or a verbatim-copy
instruction with an exact insertion anchor. The `MESSAGE` copy for `Close to
Expiring` is explicitly excluded, not a TODO.

**Type consistency:** `isSubscriptionActive(profile, todayISO)` and
`membershipAction(state)` match between Task 2 (definition) and Tasks 4–7 (use).
`setSubscriptionStatus({ memberId, status })` shape matches across Task 3
(definition), the `mutations.js` `onSettled` (`variables.memberId`) and Task 4's
`membership.mutate({ memberId, status })`. `mutationKeys.setSubscriptionStatus`
string matches across `mutationKeys.js`, `mutations.js`, `ClientDetailScreen.jsx`.
RPC param names `p_member_id` / `p_status` match between the patch (Task 1) and
`setSubscriptionStatus` (Task 3). `inactiveNotice` is defined once per file in
Task 5 before its uses.
