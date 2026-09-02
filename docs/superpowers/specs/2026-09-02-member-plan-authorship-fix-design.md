# Restore member self-authored workout plans (PR #5 follow-up)

## Context

PR #5 (`hotfix-security-integrity`, merging Andrea's security hardening —
RLS/GRANT lockdown, RPC-only writes, atomic plan/session/exercise creation,
the replace-plan versioning model) is otherwise ready to merge. It carries one
unintended regression: `create_workout_plan_secure` (`patches/015`) authorizes
only `is_professional()` acting for their assigned client, so a member can no
longer create their own workout plan. Dual-role plan creation (member and
professional both) was an agreed requirement before PR #5 existed and was
never meant to be dropped.

The rest of PR #5's rework of this area — atomic RPC writes, the
delete-in-place model replaced by versioned "replace plan", `contracts.js`,
`mutations.js` consolidation — is sound and applies uniformly to both roles.
It is not being reverted; only the one authorization predicate and the
member-side entry point it gates are being restored, on top of Andrea's
architecture rather than instead of it.

## SQL: patch 017

New file `supabase/patches/017-member-self-authored-plans.sql`, idempotent
(`create or replace`), following the existing patch format (header comment,
`begin`/`commit`, trailing `patch_017_checks` PASS/FAIL `select`).

Replaces only the authorization check inside `create_workout_plan_secure`.
The codebase already has the right predicate for "self or assigned
professional" — `public.owns_member(target)` (`patches/011-harden-definer-
functions.sql`) — which Andrea's version didn't use, having hand-rolled the
professional-only branch instead:

```sql
-- patches/015 (current, professional-only)
perform 1 from public.profiles member
where member.id = p_member_id and member.role = 'member'
  and member.assigned_pro_id = v_actor for update;
if not found or not public.is_professional() then
  raise exception 'only the assigned professional may create this plan'
    using errcode = '42501';
end if;

-- patches/017 (this fix)
perform 1 from public.profiles member
where member.id = p_member_id and member.role = 'member' for update;
if not found or not public.owns_member(p_member_id) then
  raise exception 'not authorized to create this plan for this member'
    using errcode = '42501';
end if;
```

Everything else in `create_workout_plan_secure` — the replay/idempotency
check, the `replaces_plan_id` optimistic-concurrency check, the atomic
`_insert_session_bundle` call — is untouched.

Out of scope: `create_workout_session_secure` and `add_session_exercise_secure`.
Both still gate on `plan.author_id = v_actor` plus the caller being the
member's *assigned professional*, which would also reject a self-authored
plan's author. They don't need fixing because no member-facing route calls
them any more — `patches/015`'s routing change already redirects
`/m/workout/session/new` and `/m/workout/session/:id/exercise/new` to
`/m/workout` for members; the whole "add to an existing plan" path was
replaced app-wide by "create a new plan that replaces the old one", which for
members bundles everything through `create_workout_plan_secure` in one call.

Self-check row added to `patch_017_checks`, following the pattern in
`patches/016` (regex over `pg_get_functiondef`), asserting the function body
calls `owns_member` and no longer references `is_professional` in its
authorization branch.

## Code: 3 files, minimal

- `src/routes/index.jsx` — `workout/builder` route stops redirecting to
  `/m/workout` and lazy-loads `NewPlanScreen.jsx` again, matching the
  professional-side pattern already in the tree.
- `src/features/workout/NewPlanScreen.jsx` — unchanged on the branch already
  (Andrea only rewired the route, not the screen). Drop the `authorId={user.id}`
  prop passed to `CreatePlanFlow`: that prop no longer exists on the
  component (author is derived server-side from `auth.uid()` in
  `create_workout_plan_secure`), so it's dead and should go rather than be
  silently ignored.
- `src/features/workout/WorkoutPlanScreen.jsx` — restore the "Build my own"
  button inside the `NoPlan` empty-state component (`component={Link} to="/m/
  workout/builder"`), matching its pre-PR wording and placement.

Deliberately **not** restored: the old overflow menu ("Create a new plan" /
"Edit plan") for a member who already has a plan. Replacing an *existing*
self-authored plan is an editing-UX question, not part of the "member must be
able to create a plan" requirement, and is deferred to the separate follow-up
pass on the creation flow's UX that Davide is doing next. `ClientWorkoutScreen.
jsx` already has the professional-side equivalent (`replacing` state +
`CreatePlanFlow replacesPlanId=...`) to use as the pattern when that pass
happens.

## Merge sequence

1. Commit the SQL patch and the 3 code files onto `hotfix-security-integrity`
   (same worktree/pattern as the earlier patch-016 backfill fix), push.
2. Davide applies `017-member-self-authored-plans.sql` by hand in the
   Supabase SQL editor, after `015` and `016` (already applied), checks the
   PASS/FAIL block.
3. Merge PR #5 into `main`.

No changes needed to `Relazione/4-ApplicationDesign/DigitalPrototype.tex`:
its "Plan Creation & Editing Flow" already documents plan creation as common
to both roles, written before PR #5 existed — this fix makes that description
correct again rather than requiring a rewrite.
