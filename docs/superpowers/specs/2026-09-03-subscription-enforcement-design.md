# Give the subscription status real consequences

## Context

`profiles.subscription_status` (`active | expired | suspended`) plus
`profiles.subscription_until` exist in the schema and are drawn as a coloured
pill in three places (`ClientCard`, `ClientDetailScreen`, member
`SubscriptionScreen`), but only **one** thing in the running app keys off them:
`redeem_checkin_token` refuses a gym badge scan for a suspended / expired /
date-elapsed member. Everywhere else the states are decorative — a suspended
member still books sessions, still earns reward points, and a professional can
still build them a workout or nutrition plan.

There is also **no way to change the status from the app** at all: patch 015
deliberately revoked the column `UPDATE` grant, and no RPC writes it. So the
demo's suspended/expired clients (seed + patch 005) are frozen that way forever.

This change makes the three non-active states actually gate behaviour, and adds
a professional-side button to move a client between `active` and `suspended`
(and to reactivate an `expired` one). The status change is an explicit
simulation of "the gym's billing server confirmed payment" — a real deployment
would not let a trainer do this.

## Decisions (from brainstorming)

- **Flows gated:** check-in (already done, unchanged) + appointment booking
  (member-initiated only) + workout plan creation + nutrition plan creation +
  reward-point earning.
- **PT button:** one context-aware button on the client profile.
  `active` → *Suspend membership*; `suspended` / `expired` → *Reactivate
  membership*. `Unknown` → no button.
- **Reactivate effect on the date:** set `subscription_status = 'active'`; if
  `subscription_until` is null or already past, bump it to
  `current_date + 12 months`, otherwise leave it. Suspend touches only the
  status. No dialog, no date picker.
- **Member UX:** a persistent banner in the app shell when the member's own
  subscription is not active, plus each blocked action explains itself inline
  (mirrors the existing "no professional yet" `EmptyState` in
  `MemberAppointmentsScreen`).
- **"Effective" state rule is unchanged** and stays shared: `suspended` and
  `expired` always block; `active` with an elapsed `subscription_until` also
  blocks (date outranks stale status), matching today's `redeem_checkin_token`
  and `subscriptionStateOf`.

## Database — new patch `supabase/patches/023-subscription-enforcement.sql`

Applied by hand by Davide (no agent has DB credentials). One `begin; … commit;`
with its own PASS/FAIL assertion block, in the style of `patches/011` and
`patches/015`. All functions `security definer`, `set search_path = ''`, fully
`public.`-qualified.

1. **`public.has_active_subscription(p_member_id uuid) returns boolean`** — new
   `language sql` helper, mirrors the `redeem_checkin_token` CASE as a boolean:

   ```sql
   select exists (
     select 1 from public.profiles p
     where p.id = p_member_id
       and p.subscription_status not in ('suspended', 'expired')
       and (p.subscription_until is null or p.subscription_until >= current_date)
   );
   ```

   `grant execute … to authenticated`. `redeem_checkin_token` keeps its own
   inline CASE — it needs the granular `'suspended'` vs `'expired'` string for
   the scanner message, not a boolean. Add a one-line `-- ponytail:` comment on
   both noting the intentional twin.

2. **`public.set_subscription_status_secure(p_member_id uuid, p_status public.subscription_status) returns setof public.profiles`** — new.
   - Reject unless `public.is_professional() and public.owns_member(p_member_id)`
     (`errcode 42501`).
   - Reject `p_status` other than `'active'` / `'suspended'` (`errcode 22023`) —
     `'expired'` is a system state only.
   - `update public.profiles set subscription_status = p_status,
     subscription_until = case when p_status = 'active' and (subscription_until
     is null or subscription_until < current_date) then current_date +
     interval '12 months' else subscription_until end
     where id = p_member_id and role = 'member'` returning the row; raise if not
     found.
   - `grant execute … to authenticated`.

3. **`close_workout_run_secure`** — `create or replace`, body byte-identical
   except the reward guard:
   `if v_points > 0 and public.has_active_subscription(v_row.member_id) then`.
   The run still records `pct` / `outcome`; only the `rewards` insert is
   skipped.

4. **`create_workout_plan_secure`** (8-arg signature from patch 018) —
   `create or replace`, add immediately after the existing `owns_member`
   authorization block:
   `if not public.has_active_subscription(p_member_id) then raise exception
   'member subscription is not active' using errcode = '42501'; end if;`

5. **`create_nutrition_plan_secure`** (10-arg signature from patch 022) — same
   guard, after the existing assigned-professional check.

6. **`create_appointment_secure`** (patch 015) — `create or replace`, add the
   same guard **only in the member-initiated path** (after the
   `member.assigned_pro_id = p_pro_id` check, inside / guarding the
   `v_actor = p_member_id` case) so a professional can still book a comeback
   session for a lapsed client.

PASS/FAIL block asserts: helper returns false for the seeded suspended and
expired demo clients and true for an active one; `set_subscription_status_secure`
exists with the right signature; the four replaced functions still exist.
Because it re-creates functions from 015/018/022, patch 023 must be applied
**after** those. Note the ordering in `CLAUDE.md`'s patch list when the plan is
executed.

## Client-side data plumbing

- **`src/features/clients/subscription.js`** — add two pure exports beside
  `subscriptionStateOf`, both driven by the same rule set:
  - `isSubscriptionActive(profile, todayISO)` → boolean (the JS twin of the SQL
    helper; used by the member banner, the booking gate, the rewards note and
    the two professional plan-creation gates).
  - `membershipAction(state)` → `{ label, nextStatus } | null` — maps a
    `subscriptionStateOf` result to the button: `Suspended`/`Expired` →
    `{ label: 'Reactivate membership', nextStatus: 'active' }`, `Active`/`Close
    to Expiring` → `{ label: 'Suspend membership', nextStatus: 'suspended' }`,
    `Unknown` → `null`.
  Extend **`subscription.selfcheck.js`** with cases for both (active/expiring →
  active true; suspended/expired/elapsed-date → false; each `membershipAction`
  branch incl. the null).

- **`src/data/clients.js`** — add
  `setSubscriptionStatus({ memberId, status })` → `supabase.rpc(
  'set_subscription_status_secure', { p_member_id: memberId, p_status: status })`,
  throwing on error, returning the updated row. No `.retry()` (it is a write).

- **`src/lib/mutationKeys.js`** — add `setSubscriptionStatus`.

- **`src/data/mutations.js`** — register `setSubscriptionStatus`:
  `mutationFn: setSubscriptionStatus`, `scope: { id: 'subscriptionStatus' }`
  (two rapid toggles must replay in click order), `onSettled` invalidates
  `queryPrefixes.clients` and `queryKeys.client(memberId)`. No client-generated
  id — the payload is an absolute-value update keyed by `member_id`, safe to
  replay. No `onSettled` at the call site (per `CLAUDE.md`).

## Professional UI

- **`src/features/clients/ClientDetailScreen.jsx`** — beside the `State:` chip,
  render a small `Button` from `membershipAction(state)` (hidden when it returns
  null). `useMutation({ mutationKey: mutationKeys.setSubscriptionStatus })`,
  `mutate({ memberId: clientId, status: action.nextStatus })`, `disabled` while
  pending. Per-call `onSuccess` snackbar/`Alert` ("Membership reactivated" /
  "Membership suspended"). No confirm dialog — the action is one click to
  reverse.

- **`src/features/workout/ClientWorkoutScreen.jsx`** and
  **`src/features/nutrition/NutritionPlanEditorScreen.jsx`** — both already load
  the client with `subscription_status` / `subscription_until`. When
  `!isSubscriptionActive(client, todayISO())`, replace the "create plan" /
  "create replacement plan" CTA with an `Alert severity="warning"`: "This
  client's membership is not active. Reactivate it on their profile to build a
  plan." (server-side guard is the real boundary; this just avoids opening a
  form the RPC will reject).

## Member UI

- **New `src/components/MembershipBanner.jsx`** — reads `useAuth().profile`,
  computes `subscriptionStateOf(profile, todayISO())`; renders `null` unless
  `profile.role === 'member'` and the state is `Suspended` or `Expired`.
  Otherwise a full-width `role="status"` bar in the `OfflineBanner` visual
  style: *"Membership suspended — gym access, booking and rewards are paused.
  Contact your trainer."* (wording per state). Mounted in
  **`src/layouts/AppLayout.jsx`** directly after `<OfflineBanner />` inside the
  sticky header block.

- **`src/features/trainer/MemberAppointmentsScreen.jsx`** — add a branch beside
  the existing "no assigned pro" `EmptyState`: when
  `!isSubscriptionActive(profile, todayISO())`, render `EmptyState("Membership
  not active", "Ask your trainer to reactivate it before booking.")` instead of
  the booking CTA.

- **`src/features/trainer/BookingSheet.jsx`** — defence in depth: mirror the
  existing `isPast` / `unavailable` pattern — `Alert severity="warning"` and
  `disabled` on submit when the member is not active.

- **`src/features/rewards/RewardsScreen.jsx`** — when
  `!isSubscriptionActive(profile, todayISO())`, show an `Alert severity="info"`
  above the catalogue: "Your membership is not active — you are not earning
  points right now."

- **`src/features/workout/NewPlanScreen.jsx`** (member self-authored plan) —
  same `Alert` + disabled CTA as the professional editors, using
  `useAuth().profile`. The RPC guard blocks it regardless of caller, so the UI
  must not dead-end.

## Out of scope

- No "expiring soon" (`Close to Expiring`) warnings — that state stays
  display-only as today.
- Professional side keeps no history of status changes; the button just flips
  the column.
- No block on *starting* a workout while suspended — only point earning is
  gated, so an inactive member can still train and log sets.

## Verification

1. `npm run lint` **and** `npm run build` (lint alone is not sufficient — see
   `CLAUDE.md`).
2. `node src/features/clients/subscription.selfcheck.js` (extended) + the other
   nine self-checks.
3. Apply `patches/023` on a scratch DB, run its PASS/FAIL block — every row
   PASS.
4. `node supabase/probe-rls.mjs` — no new anon exposure.
5. Manual, `npm run build && npm run preview`, both demo accounts:
   - As `andrea@trainhub.dev`: open the seeded **suspended** demo client →
     *Reactivate membership* → chip turns `Active`, `subscription_until` ~12
     months out. Suspend the active demo client → chip turns `Suspended`.
   - Suspend `daniel@trainhub.dev` (via andrea) → as daniel: shell banner
     shows; Trainer tab booking replaced by the `EmptyState`; Rewards shows the
     info alert; finishing a workout records the run but adds **no** new
     `rewards` row; the professional's Workout/Nutrition plan editors for
     daniel show the warning instead of the create CTA.
   - Badge scan for the suspended member still refused (unchanged path).
   - Reactivate daniel → banner gone, booking + points work again.
