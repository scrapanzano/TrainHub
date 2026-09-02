# Workout Plan Creation Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-session plan-creation form with a multi-session draft-then-commit wizard (spec: `docs/superpowers/specs/2026-09-02-workout-creation-redesign-design.md`, commit `89ac3db`), close the remaining in-place-editing paths on an existing plan, and expand the exercise catalogue from 4 to 7 muscle groups.

**Architecture:** `CreatePlanFlow.jsx` becomes a 3-step local state machine (`meta` → `session` (repeatable) → `summary`) that writes nothing until a single atomic RPC call at the end. The RPC (`create_workout_plan_secure`) is extended to accept an array of session bundles instead of one, reusing the existing `_insert_session_bundle` helper in a loop, so atomicity is unchanged. `ClientWorkoutScreen.jsx` loses its inline "Add a session"/"Add exercise" paths, leaving replace-via-wizard as the only way to change an existing plan.

**Tech Stack:** React 19 + Vite 8, plain JS/JSX, MUI v9, React Router 8 (lazy per-screen), TanStack Query v5, Supabase (Postgres, RLS, RPC-only writes), hand-applied SQL patches.

## Global Constraints

- No TypeScript. Plain JS/JSX, ESM.
- All styling through the MUI theme; no CSS files, no colour literals.
- `npm run lint` AND `npm run build` must both pass — lint alone does not catch a missing icon export or a broken import path (`CLAUDE.md`).
- No `eslint-disable`, ever. If lint objects, the code is wrong.
- No test runner is configured and none is being added. Non-trivial pure logic gets an `assert`-based `*.selfcheck.js`, run with plain `node <path>`. This project has no Jest/pytest — every "run the test" step below means either a selfcheck or a manual verification, never a test-runner invocation.
- Every write is registered in `src/data/mutations.js` via `setMutationDefaults`. A call site must never pass `onSettled` to `useMutation` (it replaces the registered handler); per-call `mutate(vars, { onSuccess })` is fine.
- A client-generated id is created in an event handler, never in a render body (`react-hooks/purity`).
- `position` is `Math.max(0, ...positions) + 1` or a fresh array index at submit time, never a stored count.
- `supabase/` patches are applied by hand by Davide in the Supabase SQL editor — no agent has DB credentials. Every patch ends with a `select ... case when actual is not distinct from expected then 'PASS' else 'FAIL' end status` block, and is idempotent (`create or replace` / `on conflict do nothing`).
- **Whitespace-stripped `LIKE` self-checks:** when a check does `regexp_replace(lower(pg_get_functiondef(...)), '[[:space:]]+', '', 'g')`, the comparison pattern must ALSO have no spaces in it (`patches/017` shipped this bug once already — a spaced pattern can never match a space-stripped haystack).
- Commits: Conventional Commits, Davide as sole author, **no `Co-Authored-By` trailer**. Stage only the files each task names.

---

### Task 1: SQL patch 018 — multi-session plan creation

**Files:**
- Create: `supabase/patches/018-multi-session-plan-creation.sql`

**Interfaces:**
- Consumes: `public._insert_session_bundle(uuid, uuid, text, int, jsonb)` (unchanged, defined in `patches/015`), `public.owns_member(uuid)` (unchanged, `patches/011`).
- Produces: `public.create_workout_plan_secure(uuid, uuid, uuid, text, text, text, int, jsonb) returns setof public.workout_plans` — the trailing arg is now `p_sessions jsonb`, an array of `{id, name, position, exercises}` objects (one per drafted session; `exercises` keeps the shape `_insert_session_bundle` already expects). Task 2's `createPlan()` calls this new signature.

- [ ] **Step 1: Write the patch file**

```sql
-- Patch 018 -- create a workout plan with any number of sessions at once.
--
-- create_workout_plan_secure (patches/015, authorization widened by
-- patches/017) took exactly one session bundle, matching the old two-step
-- creation flow. The new wizard drafts as many sessions as the member or
-- professional wants before writing anything, so the trailing p_session_id/
-- p_session_name/p_exercises become one p_sessions array, one element per
-- drafted session, each shaped the way public._insert_session_bundle
-- already expects its own arguments.
--
-- Every session in the array commits in the same transaction as the plan
-- itself (a plpgsql function body already is one transaction), so this stays
-- atomic exactly as patches/015 first made it. The replay check is
-- unchanged: it compares only plan-level fields, which is correct because a
-- plan row and its sessions are only ever written together -- if the plan
-- row already exists with matching fields, its sessions were already
-- inserted by that same earlier call.
--
-- The old 10-argument signature is a DIFFERENT overload as far as Postgres
-- is concerned (create or replace matches by full parameter signature, not
-- by name alone) -- dropped explicitly first, or it would linger alongside
-- the new one and make every self-check below ambiguous.
--
-- Idempotent: safe to replay.

begin;

drop function if exists public.create_workout_plan_secure(
  uuid, uuid, uuid, text, text, text, int, uuid, text, jsonb);

create or replace function public.create_workout_plan_secure(
  p_plan_id uuid, p_member_id uuid, p_replaces_plan_id uuid,
  p_name text, p_goal text, p_level text, p_weeks int,
  p_sessions jsonb
) returns setof public.workout_plans
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_current uuid;
  v_row public.workout_plans%rowtype;
  v_session jsonb;
begin
  perform 1 from public.profiles member
  where member.id = p_member_id and member.role = 'member' for update;
  if not found or not public.owns_member(p_member_id) then
    raise exception 'not authorized to create this plan for this member'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) = 0 then
    raise exception 'a plan needs at least one session' using errcode = '22023';
  end if;

  select plan.* into v_row from public.workout_plans plan
  where plan.id = p_plan_id;
  if found then
    if v_row.member_id is distinct from p_member_id
       or v_row.author_id is distinct from v_actor
       or v_row.name is distinct from p_name
       or v_row.goal is distinct from nullif(p_goal, '')
       or v_row.level is distinct from nullif(p_level, '')
       or v_row.weeks is distinct from p_weeks
       or v_row.replaces_plan_id is distinct from p_replaces_plan_id then
      raise exception 'plan id is already used by different content'
        using errcode = '23505';
    end if;
    return next v_row;
    return;
  end if;

  select plan.id into v_current from public.workout_plans plan
  where plan.member_id = p_member_id
  order by plan.created_at desc, plan.id desc limit 1;
  if v_current is distinct from p_replaces_plan_id then
    raise exception 'the member plan changed before this save arrived'
      using errcode = '40001';
  end if;

  insert into public.workout_plans (
    id, member_id, author_id, name, goal, level, weeks, replaces_plan_id
  ) values (
    p_plan_id, p_member_id, v_actor, p_name, nullif(p_goal, ''),
    nullif(p_level, ''), p_weeks, p_replaces_plan_id
  ) returning * into v_row;

  for v_session in select * from jsonb_array_elements(p_sessions)
  loop
    perform public._insert_session_bundle(
      (v_session->>'id')::uuid, p_plan_id, v_session->>'name',
      (v_session->>'position')::int, v_session->'exercises');
  end loop;

  return next v_row;
end;
$$;

revoke execute on function public.create_workout_plan_secure(
  uuid, uuid, uuid, text, text, text, int, jsonb
) from public, anon;
grant execute on function public.create_workout_plan_secure(
  uuid, uuid, uuid, text, text, text, int, jsonb
) to authenticated;

drop table if exists pg_temp.patch_018_checks;
create temporary table patch_018_checks (
  check_name text not null,
  actual text,
  expected text not null
) on commit preserve rows;

insert into patch_018_checks (check_name, actual, expected) values
  ('the old single-session overload is gone',
   (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   '1'),
  ('plan creation loops over multiple sessions',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%jsonb_array_elements(p_sessions)%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   'true'),
  ('self-authorship check is still in place',
   (select coalesce(
      regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g')
        like '%notpublic.owns_member(p_member_id)%',
      false)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'),
   'true'),
  ('operation remains hardened',
   (select (count(*) = 1)::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_workout_plan_secure'
      and p.prosecdef and coalesce(
        p.proconfig && array['search_path=', 'search_path=""'], false)),
   'true'),
  ('authenticated caller can create a plan',
   has_function_privilege(
     'authenticated',
     'public.create_workout_plan_secure(uuid,uuid,uuid,text,text,text,int,jsonb)',
     'execute')::text,
   'true'),
  ('anonymous caller cannot create a plan',
   has_function_privilege(
     'anon',
     'public.create_workout_plan_secure(uuid,uuid,uuid,text,text,text,int,jsonb)',
     'execute')::text,
   'false');

commit;

-- This must remain the final statement so Supabase displays every check.
select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_018_checks
order by check_name;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/patches/018-multi-session-plan-creation.sql
git commit -m "feat(db): let create_workout_plan_secure take multiple sessions"
```

- [ ] **Step 3: Hand off to Davide**

This patch cannot be applied by an agent (no DB credentials). Ask Davide to
run it in the Supabase SQL editor after `017` and confirm every row in the
final `select` reads `PASS`. Do not proceed to manually test Task 3's UI
against the live app until this is confirmed — lint/build in later tasks do
not touch the database and will pass regardless.

---

### Task 2: `contracts.js` — bundle every drafted session, and `workouts.js` — call the new RPC shape

**Files:**
- Modify: `src/features/workout/contracts.js`
- Modify: `src/features/workout/contracts.selfcheck.js`
- Modify: `src/data/workouts.js:174-211` (the `createPlan` export)

**Interfaces:**
- Consumes: `createUuid` (`src/lib/uuid.js`, unchanged), `buildSessionExercisePayloads` (same file, unchanged).
- Produces: `buildSessionPayloads(sessions, createId = createUuid)` — `sessions` is `Array<{id?, name, exercises}>` (the wizard's local draft shape); returns `Array<{id, name, position, exercises}>` matching patch 018's `p_sessions`. `createPlan({ id, memberId, replacesPlanId, name, goal, level, weeks, sessions })` — `sessions` is exactly `buildSessionPayloads`'s return value. Task 3 calls both.

- [ ] **Step 1: Add `buildSessionPayloads` to `contracts.js`**

Append to `src/features/workout/contracts.js`:

```js
/**
 * Freeze every drafted session into the JSON contract `create_workout_plan_
 * secure` (patches/018) consumes: an ordered array of session bundles, each
 * built the same way `buildSessionExercisePayloads` already builds one.
 */
export function buildSessionPayloads(sessions, createId = createUuid) {
  return (sessions ?? []).map((session, index) => ({
    id: session.id ?? createId(),
    name: session.name,
    position: index + 1,
    exercises: buildSessionExercisePayloads(session.exercises, createId),
  }))
}
```

- [ ] **Step 2: Extend the selfcheck**

Append to `src/features/workout/contracts.selfcheck.js` (before the final
`console.log`), reusing the `draft`/`createId` already declared there:

```js
import { buildSessionPayloads } from './contracts.js'

const sessions = [
  { name: 'Push Day', exercises: draft },
  { id: 'stable-session', name: 'Pull Day', exercises: [] },
]

const built = buildSessionPayloads(sessions, createId)
assert.equal(built.length, 2)
assert.equal(built[0].position, 1)
assert.equal(built[1].position, 2)
assert.equal(built[1].id, 'stable-session')
assert.deepEqual(built[1].exercises, [])
// A session missing an id gets one from the factory, same as an exercise row.
assert.equal(nextId, 4)
assert.deepEqual(buildSessionPayloads([], createId), [])
```

(Add the `buildSessionPayloads` import to the existing `import { ... } from
'./contracts.js'` line at the top rather than a second import statement.)

- [ ] **Step 3: Run the selfcheck**

Run: `node src/features/workout/contracts.selfcheck.js`
Expected: `workout contracts: OK`

- [ ] **Step 4: Update `createPlan()` in `src/data/workouts.js`**

Replace the current export (lines 174-211) with:

```js
/**
 * Create a workout plan for a member, with all of its drafted sessions, in
 * one atomic call.
 *
 * Only the member themselves or their assigned professional may call it
 * (patches/017). The predecessor ID is an optimistic concurrency check: a
 * queued plan cannot silently replace a newer plan created while the device
 * was offline. The plan and every session/exercise in it commit together
 * (patches/018), and an exact replay returns the existing plan without
 * re-inserting anything.
 */
export async function createPlan({
  id, memberId, replacesPlanId, name, goal, level, weeks, sessions,
}) {
  const { data, error } = await supabase
    .rpc('create_workout_plan_secure', {
      p_plan_id: id,
      p_member_id: memberId,
      p_replaces_plan_id: replacesPlanId ?? null,
      p_name: name,
      p_goal: goal || null,
      p_level: level || null,
      p_weeks: weeks,
      p_sessions: sessions,
    })
    .single()

  if (error) throw error
  return data
}
```

Leave `createSession()` and `addSessionExercise()` in this file untouched
for now — Task 6 removes them, once Tasks 3-5 have removed every caller.

- [ ] **Step 5: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds (this does not touch the database, so it succeeds
independently of whether Task 1's patch has been applied yet).

- [ ] **Step 6: Commit**

```bash
git add src/features/workout/contracts.js src/features/workout/contracts.selfcheck.js src/data/workouts.js
git commit -m "feat: bundle every drafted session for atomic plan creation"
```

---

### Task 3: `CreatePlanFlow.jsx` — the multi-session wizard, and `PlanSummary.jsx`

**Files:**
- Modify: `src/features/workout/CreatePlanFlow.jsx` (full rewrite)
- Modify: `src/features/workout/SessionForm.jsx` (add an `initial` prop, fix a stale doc comment)
- Create: `src/features/workout/PlanSummary.jsx`

**Interfaces:**
- Consumes: `PlanForm` (`onSubmit`, unchanged), `SessionForm` (new `initial` prop, see below), `mutationKeys.createPlan`, `buildSessionPayloads` (Task 2), `createUuid`.
- Produces: `CreatePlanFlow({ memberId, replacesPlanId = null, onDone, onAbandon })` — **`onAbandon` is a new required prop**, called after the user confirms discarding the draft from the confirmation dialog. `PlanSummary({ sessions, pending, paused, error, onAddSession, onEditSession, onDeleteSession, onConfirm })` — a new presentational component, `sessions: Array<{id, name, exercises}>`. Task 4 updates `CreatePlanFlow`'s two callers to pass `onAbandon`.

- [ ] **Step 1: Add an `initial` prop to `SessionForm.jsx`**

In `src/features/workout/SessionForm.jsx`, change the two `useState` lines
and the JSDoc/prop list:

```js
/**
 * Build one session: a name and an ordered list of prescribed exercises.
 *
 * Shared by the member's own wizard and the professional's plan wizard,
 * because both produce exactly the same session payload. The form owns
 * only its draft state; who is being written for, and what happens on
 * success, belong to the caller.
 *
 * @param {object}   props
 * @param {Array}    props.catalogue   Exercises to choose from. Never undefined.
 * @param {Function} props.onSubmit    `({name, exercises}) => void`
 * @param {boolean}  props.pending     A save is in flight.
 * @param {boolean}  props.paused      The save is parked offline.
 * @param {?Error}   props.error       The last failure, if any.
 * @param {string}   props.submitLabel Idle label for the button.
 * @param {?object}  props.initial     `{name, exercises}` to reopen with, editing a
 *   drafted session from the summary. `exercises` is shaped the way this
 *   form's own `onSubmit` produces it.
 */
export default function SessionForm({
  catalogue,
  onSubmit,
  pending = false,
  paused = false,
  error = null,
  submitLabel = 'Save session',
  initial = null,
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [rows, setRows] = useState(() =>
    (initial?.exercises ?? []).map((item) => ({
      exercise: catalogue.find((option) => option.id === item.exerciseId),
      targetSets: item.targetSets,
      targetReps: item.targetReps,
      targetWeight: item.targetWeight ?? '',
      restSeconds: item.restSeconds,
      notes: item.notes ?? '',
    })),
  )
  const [picked, setPicked] = useState(null)
```

Everything else in the file is unchanged.

- [ ] **Step 2: Create `PlanSummary.jsx`**

```jsx
import {
  Alert, Box, Button, Card, CardContent, IconButton, Stack, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'

/**
 * Review the sessions drafted so far, before anything is written.
 *
 * Every action here is local until `onConfirm` fires the one atomic write --
 * editing or deleting a drafted session never touches the server.
 *
 * @param {object}   props
 * @param {Array}    props.sessions        `{id, name, exercises}[]`, drafted so far.
 * @param {boolean}  props.pending         The create/replace write is in flight.
 * @param {boolean}  props.paused          The write is parked offline.
 * @param {?Error}   props.error           The last failure, if any.
 * @param {Function} props.onAddSession    Start drafting another session.
 * @param {Function} props.onEditSession   `(index) => void`, reopen a drafted session.
 * @param {Function} props.onDeleteSession `(index) => void`, drop a drafted session.
 * @param {Function} props.onConfirm       Fire the one atomic write.
 */
export default function PlanSummary({
  sessions,
  pending,
  paused,
  error,
  onAddSession,
  onEditSession,
  onDeleteSession,
  onConfirm,
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Review your plan</Typography>

      <Stack spacing={2}>
        {sessions.map((session, index) => (
          <Card key={session.id}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>{session.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {session.exercises.length} exercises
                  </Typography>
                </Box>
                <Button size="small" onClick={() => onEditSession(index)} disabled={pending}>
                  Edit
                </Button>
                <IconButton
                  aria-label={`Remove ${session.name}`}
                  disabled={pending}
                  onClick={() => {
                    // `confirm` rather than a dialog component: one destructive
                    // action on one screen, already accessible and blocking.
                    if (window.confirm(`Remove "${session.name}" from this plan?`)) {
                      onDeleteSession(index)
                    }
                  }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Button variant="outlined" size="large" fullWidth onClick={onAddSession} disabled={pending}>
        Add another session
      </Button>

      {/* Offline the mutation pauses: `onSuccess` never runs, no error is
          raised, and the button would sit on "Creating…" forever with nothing
          to explain it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. This plan is saved on your device and will be created when you
          reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">
          {error.message ?? 'The plan could not be created. Try again.'}
        </Alert>
      ) : null}

      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={sessions.length === 0 || pending}
        onClick={onConfirm}
      >
        {paused ? 'Saved offline' : pending ? 'Creating…' : 'Confirm & create plan'}
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 3: Rewrite `CreatePlanFlow.jsx`**

```jsx
import { useState } from 'react'
import { Button } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PlanForm from './PlanForm.jsx'
import SessionForm from './SessionForm.jsx'
import PlanSummary from './PlanSummary.jsx'
import { buildSessionPayloads } from './contracts.js'

/**
 * Build a plan as a local draft -- meta, then any number of sessions -- and
 * write the whole thing in one atomic call when the member or professional
 * confirms. Nothing reaches the server before that: abandoning at any step
 * discards the draft and leaves an existing plan, if there was one, untouched.
 *
 * Used by both roles. Only `memberId`, `replacesPlanId`, `onDone` and
 * `onAbandon` differ.
 *
 * @param {object}   props
 * @param {string}   props.memberId       Who the plan is for.
 * @param {?string}  props.replacesPlanId The plan this one supersedes, if any.
 * @param {Function} props.onDone         The atomic write succeeded.
 * @param {Function} props.onAbandon      The user confirmed discarding the draft.
 */
export default function CreatePlanFlow({ memberId, replacesPlanId = null, onDone, onAbandon }) {
  const [step, setStep] = useState('meta') // 'meta' | 'session' | 'summary'
  const [meta, setMeta] = useState(null)
  const [sessions, setSessions] = useState([])
  const [editingIndex, setEditingIndex] = useState(null)

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const createPlan = useMutation({ mutationKey: mutationKeys.createPlan })

  const confirmAbandon = () => {
    // `confirm` rather than a dialog component: one destructive action in one
    // flow, already accessible and blocking. Required by the flow's own rule
    // that leaving it is always available but always confirmed.
    if (window.confirm('Discard this plan? Nothing entered so far will be saved.')) {
      onAbandon()
    }
  }

  let body

  if (step === 'meta') {
    body = (
      <PlanForm
        onSubmit={(values) => {
          setMeta(values)
          setStep('session')
        }}
      />
    )
  } else if (catalogue.isPending) {
    body = <LoadingState />
  } else if (catalogue.isError && catalogue.data === undefined) {
    body = <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  } else if (step === 'session') {
    // Reopening a drafted session from the summary pre-fills the form;
    // adding a new one starts blank.
    const editing = editingIndex !== null ? sessions[editingIndex] : null
    body = (
      <SessionForm
        catalogue={catalogue.data}
        submitLabel={editing ? 'Save changes' : 'Add session'}
        initial={editing}
        onSubmit={({ name, exercises }) => {
          const drafted = { id: editing?.id ?? createUuid(), name, exercises }
          setSessions((current) =>
            editingIndex === null
              ? [...current, drafted]
              : current.map((session, index) => (index === editingIndex ? drafted : session)),
          )
          setEditingIndex(null)
          setStep('summary')
        }}
      />
    )
  } else {
    // step === 'summary'
    body = (
      <PlanSummary
        sessions={sessions}
        pending={createPlan.isPending}
        paused={createPlan.isPending && createPlan.isPaused}
        error={createPlan.error}
        onAddSession={() => {
          setEditingIndex(null)
          setStep('session')
        }}
        onEditSession={(index) => {
          setEditingIndex(index)
          setStep('session')
        }}
        onDeleteSession={(index) =>
          setSessions((current) => current.filter((_, i) => i !== index))
        }
        onConfirm={() => {
          // Generated here, in the handler: `react-hooks/purity` forbids
          // `crypto.randomUUID()` in a render body. It is also the
          // idempotency key the secure operation checks, so a replay returns
          // the same bundle rather than creating a second plan that hides
          // the first.
          createPlan.mutate(
            {
              id: createUuid(),
              memberId,
              replacesPlanId,
              ...meta,
              sessions: buildSessionPayloads(sessions),
            },
            { onSuccess: onDone },
          )
        }}
      />
    )
  }

  return (
    <>
      {body}
      <Button
        onClick={confirmAbandon}
        disabled={createPlan.isPending}
        sx={{ mt: 2 }}
        fullWidth
      >
        Cancel
      </Button>
    </>
  )
}
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds. (`ClientWorkoutScreen.jsx` and `NewPlanScreen.jsx`
now fail to build because they don't yet pass the new required `onAbandon`
prop — that's expected and fixed in Task 4. If the build fails only on
those two files for a missing/undefined `onAbandon`, that is not a defect in
this task; confirm it's exactly those two before moving on.)

Note: React does not error at build time for a missing non-required prop
(there's no `propTypes` in this codebase), so the build will actually
succeed even before Task 4 -- `onAbandon` will just be `undefined` at
runtime until then. Manual testing of the abandon button should wait for
Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/features/workout/CreatePlanFlow.jsx src/features/workout/SessionForm.jsx src/features/workout/PlanSummary.jsx
git commit -m "feat: multi-session draft-then-commit wizard for plan creation"
```

---

### Task 4: Simplify `ClientWorkoutScreen.jsx` and wire `onAbandon` everywhere `CreatePlanFlow` is used

**Files:**
- Modify: `src/features/clients/ClientWorkoutScreen.jsx` (full rewrite)
- Modify: `src/features/workout/NewPlanScreen.jsx`

**Interfaces:**
- Consumes: `CreatePlanFlow` (Task 3, now requires `onAbandon`).

- [ ] **Step 1: Rewrite `ClientWorkoutScreen.jsx`**

```jsx
import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Divider, IconButton, Stack, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import CreatePlanFlow from '../workout/CreatePlanFlow.jsx'
import { runStatusOf } from '../../lib/week.js'
import { sessionStatusOf } from '../workout/status.js'

export default function ClientWorkoutScreen() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [replacing, setReplacing] = useState(false)

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  if (plan.isPending || client.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const clientName = client.data?.full_name ?? 'this client'

  // No plan yet. Same wizard the member uses on themselves: everything is
  // drafted locally and written in one atomic call, so abandoning leaves
  // nothing behind.
  if (plan.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">New plan</Typography>
        <Typography color="text.secondary">
          {clientName} has no workout plan yet.
        </Typography>
        <CreatePlanFlow
          memberId={clientId}
          onDone={() => plan.refetch()}
          onAbandon={() => navigate(`/p/clients/${clientId}`)}
        />
      </Stack>
    )
  }

  const sessions = plan.data.sessions

  if (replacing) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">Replace plan</Typography>
        <Alert severity="info">
          The current plan stays in the client history. The new one becomes active only when its
          first complete session is saved.
        </Alert>
        <CreatePlanFlow
          memberId={clientId}
          replacesPlanId={plan.data.plan.id}
          onDone={() => {
            setReplacing(false)
            plan.refetch()
          }}
          onAbandon={() => setReplacing(false)}
        />
      </Stack>
    )
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton
          component={Link}
          to={`/p/clients/${clientId}`}
          aria-label={`Back to ${clientName}`}
          edge="start"
        >
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1" noWrap>{plan.data.plan.name}</Typography>
          <Typography color="text.secondary" noWrap>{clientName}</Typography>
          <Typography color="text.secondary">
            {[plan.data.plan.goal, plan.data.plan.level, `${plan.data.plan.weeks} weeks`]
              .filter(Boolean)
              .join(' • ')}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h2">Sessions</Typography>

        {sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="This plan has no sessions. Replace it to add some."
          />
        ) : null}

        {sessions.map((session) => (
          <Card key={session.id}>
            <CardContent>
              <Typography variant="h3" noWrap>{session.name}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {/* Derived from this week's runs, not the stored column: the
                    coach wants to know whether the client trained THIS week. */}
                {session.exerciseCount} exercises •{' '}
                {sessionStatusOf(runStatusOf(session.runs, plan.data.weekStart).status).label}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Divider />

      <Button variant="outlined" size="large" fullWidth onClick={() => setReplacing(true)}>
        Create replacement plan
      </Button>
    </Stack>
  )
}
```

- [ ] **Step 2: Wire `onAbandon` in `NewPlanScreen.jsx`**

In `src/features/workout/NewPlanScreen.jsx`, add the prop to the existing
`CreatePlanFlow` element:

```jsx
      <CreatePlanFlow
        memberId={user.id}
        // `replace`, so Back leaves the plan rather than reopening the form
        // that just created it.
        onDone={() => navigate('/m/workout', { replace: true })}
        onAbandon={() => navigate('/m/workout', { replace: true })}
      />
```

- [ ] **Step 3: Lint and build**

Run: `npm run lint`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/features/clients/ClientWorkoutScreen.jsx src/features/workout/NewPlanScreen.jsx
git commit -m "refactor: replace-only editing on ClientWorkoutScreen, wire abandon"
```

---

### Task 5: Delete the dead in-place-editing screens and their routes

**Files:**
- Delete: `src/features/workout/AddExerciseScreen.jsx`
- Delete: `src/features/workout/AddSessionScreen.jsx`
- Modify: `src/routes/index.jsx`

**Interfaces:** None — nothing else imports either deleted file after Task 4
(`ClientWorkoutScreen.jsx` no longer links to `AddExerciseScreen.jsx`, and no
route has ever pointed at `AddSessionScreen.jsx`).

- [ ] **Step 1: Delete the two screen files**

```bash
git rm src/features/workout/AddExerciseScreen.jsx src/features/workout/AddSessionScreen.jsx
```

- [ ] **Step 2: Remove the professional route that loaded `AddExerciseScreen.jsx`**

In `src/routes/index.jsx`, delete this block from the `/p` route's children
(it sat between the `clients/:clientId/chat` and `clients/:clientId/
nutrition` entries):

```jsx
      {
        path: 'clients/:clientId/workout/session/:sessionId/exercise/new',
        lazy: async () => ({
          Component: (await import('../features/workout/AddExerciseScreen.jsx')).default,
        }),
      },
```

Leave the member-side redirect stubs (`workout/session/new` and `workout/
session/:sessionId/exercise/new`, both `<Navigate to="/m/workout" replace
/>`) exactly as they are — they cost nothing and protect a stale
service-worker-cached link from landing on a 404.

- [ ] **Step 3: Lint and build**

Run: `npm run lint`
Expected: no errors (confirms nothing else still imports either deleted file).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/routes/index.jsx
git commit -m "chore: delete the dead in-place session/exercise editing screens"
```

---

### Task 6: Remove the now-unused `createSession`/`addSessionExercise` mutation plumbing

**Files:**
- Modify: `src/lib/mutationKeys.js`
- Modify: `src/data/mutations.js`
- Modify: `src/data/workouts.js`

**Interfaces:** None produced — this only removes exports nothing calls any
more after Task 5.

- [ ] **Step 1: Remove the two keys from `mutationKeys.js`**

Delete these two lines:

```js
  createSession: ['createSession'],
```
```js
  addSessionExercise: ['addSessionExercise'],
```

- [ ] **Step 2: Remove their registrations from `mutations.js`**

Delete this whole block:

```js
  // Plan and session bundles are atomic server operations. They still share a
  // scope because two additions to the same plan can calculate the same next
  // position while offline. Serial replay makes the first win deterministically
  // and lets the second surface the concurrency conflict instead of racing.
  // `position` is
  // `Math.max(...) + 1` read from cache, so two sessions added in parallel
  // would compute the same position and the second would be rejected by
  // `unique (plan_id, position)`.
  const planWriteScope = { id: 'planWrite' }

  queryClient.setMutationDefaults(mutationKeys.createSession, {
    mutationFn: createSession,
    scope: planWriteScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.createPlan, {
    mutationFn: createPlan,
    scope: planWriteScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
      // `fetchClients` derives each roster row's `goal` from the client's
      // newest `workout_plans` row, so the roster goes stale the moment a new
      // plan is created unless this family is invalidated too.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.clients })
    },
  })

  // `position` is
  // `Math.max(...) + 1` computed from cache, so two adds replayed in parallel
  // would land on the same position and `unique (session_id, position)` would
  // reject the second.
  queryClient.setMutationDefaults(mutationKeys.addSessionExercise, {
    mutationFn: addSessionExercise,
    scope: { id: 'sessionExercises' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })
```

Replace it with:

```js
  // A plan's whole write -- itself and every drafted session -- is one
  // atomic RPC call (patches/018), so this no longer shares a scope with a
  // sibling mutation the way it did when a session was a second, separate
  // write. Kept regardless: if a member somehow queues two plan creations
  // offline, replaying them in order is still the safer default over racing.
  queryClient.setMutationDefaults(mutationKeys.createPlan, {
    mutationFn: createPlan,
    scope: { id: 'planWrite' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
      // `fetchClients` derives each roster row's `goal` from the client's
      // newest `workout_plans` row, so the roster goes stale the moment a new
      // plan is created unless this family is invalidated too.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.clients })
    },
  })
```

Update the top import line, removing the two names:

```js
import {
  addSessionExercise, createPlan, createSession, logSet,
} from './workouts.js'
```
becomes
```js
import { createPlan, logSet } from './workouts.js'
```

- [ ] **Step 3: Remove the two functions from `workouts.js`**

Delete the `createSession()` export (its JSDoc block plus the function) and
the `addSessionExercise()` export (its JSDoc block plus the function) — both
now fully unused.

- [ ] **Step 4: Lint and build**

Run: `npm run lint`
Expected: no errors (confirms the import cleanup left nothing dangling).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mutationKeys.js src/data/mutations.js src/data/workouts.js
git commit -m "chore: remove the unused createSession/addSessionExercise mutations"
```

---

### Task 7: Exercise catalogue — Biceps, Triceps, Core

**Files:**
- Modify: `supabase/seed.sql`
- Create: `supabase/patches/019-expand-exercise-catalogue.sql`

**Interfaces:** None — content only, no schema or code change (`muscle_group`
is free text; `SessionForm.jsx`'s `Autocomplete` already groups by whatever
values are present).

- [ ] **Step 1: Extend `seed.sql`**

In `supabase/seed.sql`, extend the existing `insert into exercises (...)
values (...)` list (so a fresh install is born with the full catalogue).
Add these 12 rows before the closing `on conflict (name) do nothing;`:

```sql
    ('Barbell Curl',        'Biceps',  'Barbell',   'Elbows pinned to the ribs, no swing.'),
    ('Hammer Curl',         'Biceps',  'Dumbbell',  'Neutral grip throughout, control the descent.'),
    ('Incline Dumbbell Curl','Biceps', 'Dumbbell',  'Bench at 45 degrees for a deep stretch.'),
    ('Cable Curl',          'Biceps',  'Cable',     'Constant tension, stop short of lockout.'),
    ('Tricep Pushdown',     'Triceps', 'Cable',     'Elbows fixed at the sides, full extension.'),
    ('Skull Crusher',       'Triceps', 'Barbell',   'Lower to the forehead, elbows stay narrow.'),
    ('Overhead Tricep Extension', 'Triceps', 'Dumbbell', 'Elbows close to the head, full stretch.'),
    ('Close-Grip Bench Press', 'Triceps', 'Barbell', 'Hands shoulder-width, elbows tucked.'),
    ('Plank',               'Core',    'Bodyweight','Straight line from shoulders to heels.'),
    ('Hanging Leg Raise',   'Core',    'Bodyweight','Curl the pelvis, avoid swinging.'),
    ('Cable Crunch',        'Core',    'Cable',     'Round the spine, hips stay still.'),
    ('Russian Twist',       'Core',    'Bodyweight','Rotate from the torso, feet may stay down.')
```

- [ ] **Step 2: Write patch `019` for the shared database**

```sql
-- Patch 019 -- expand the exercise catalogue to Biceps, Triceps and Core.
--
-- The seeded catalogue only ever covered Chest, Legs, Back and Shoulders.
-- `muscle_group` is free text -- `SessionForm.jsx`'s Autocomplete groups by
-- whatever is present, no schema constraint -- so this is content, not a
-- schema change: same `on conflict (name) do nothing` pattern `seed.sql`
-- already uses.
--
-- Idempotent: safe to replay.

begin;

insert into public.exercises (name, muscle_group, equipment, instructions) values
    ('Barbell Curl',        'Biceps',  'Barbell',   'Elbows pinned to the ribs, no swing.'),
    ('Hammer Curl',         'Biceps',  'Dumbbell',  'Neutral grip throughout, control the descent.'),
    ('Incline Dumbbell Curl','Biceps', 'Dumbbell',  'Bench at 45 degrees for a deep stretch.'),
    ('Cable Curl',          'Biceps',  'Cable',     'Constant tension, stop short of lockout.'),
    ('Tricep Pushdown',     'Triceps', 'Cable',     'Elbows fixed at the sides, full extension.'),
    ('Skull Crusher',       'Triceps', 'Barbell',   'Lower to the forehead, elbows stay narrow.'),
    ('Overhead Tricep Extension', 'Triceps', 'Dumbbell', 'Elbows close to the head, full stretch.'),
    ('Close-Grip Bench Press', 'Triceps', 'Barbell', 'Hands shoulder-width, elbows tucked.'),
    ('Plank',               'Core',    'Bodyweight','Straight line from shoulders to heels.'),
    ('Hanging Leg Raise',   'Core',    'Bodyweight','Curl the pelvis, avoid swinging.'),
    ('Cable Crunch',        'Core',    'Cable',     'Round the spine, hips stay still.'),
    ('Russian Twist',       'Core',    'Bodyweight','Rotate from the torso, feet may stay down.')
on conflict (name) do nothing;

drop table if exists pg_temp.patch_019_checks;
create temporary table patch_019_checks (
  check_name text not null, actual text, expected text not null
) on commit preserve rows;

insert into patch_019_checks (check_name, actual, expected) values
  ('seven muscle groups are represented',
   (select count(distinct muscle_group)::text from public.exercises), '7'),
  ('at least three exercises per muscle group',
   (select (min(cnt) >= 3)::text from (
     select count(*) cnt from public.exercises group by muscle_group
   ) counts),
   'true');

commit;

select check_name, actual, expected,
  case when actual is not distinct from expected then 'PASS' else 'FAIL' end status
from patch_019_checks
order by check_name;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/seed.sql supabase/patches/019-expand-exercise-catalogue.sql
git commit -m "feat(db): expand the exercise catalogue to Biceps, Triceps and Core"
```

- [ ] **Step 4: Hand off to Davide**

Same as Task 1 — ask Davide to run `019` in the Supabase SQL editor and
confirm both check rows read `PASS`.

---

### Task 8: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed, zero warnings introduced by this plan's changes.

- [ ] **Step 2: Run every selfcheck touched by this plan**

Run: `node src/features/workout/contracts.selfcheck.js`
Expected: `workout contracts: OK`

- [ ] **Step 3: Confirm both SQL patches are applied**

Ask Davide to confirm `018` and `019` both show a full `PASS` block in the
Supabase SQL editor (Tasks 1 and 7's handoff steps).

- [ ] **Step 4: Manual click-through (Davide, in a worktree running `npm run
      dev`)**

1. As `daniel@trainhub.dev` (member, currently has no plan): go to `/m/
   workout`, click **Build my own**. Fill the plan form, add a session with
   2 exercises, confirm it — lands on the summary with 1 session listed.
   Click **Add another session**, add a second session, confirm — summary
   now shows 2. Click **Edit** on the first session, change its name, save
   — summary reflects the new name. Click **Confirm & create plan** —
   redirected to `/m/workout` showing the new plan with both sessions.
2. Repeat the start of step 1 but click **Cancel** partway through (after
   the plan form, or after drafting a session) — confirm the browser
   confirmation dialog appears, confirm it, and verify no plan was created
   (no change to `/m/workout`).
3. As `andrea@trainhub.dev` (professional), open a client who already has a
   plan (`/p/clients/:clientId/workout`): confirm there is no "Add a
   session" or "Add exercise" button anywhere on the screen — only "Create
   replacement plan". Use it, confirm the wizard behaves the same way as
   step 1, and that the old plan is still reachable in the client's history
   (not deleted).
4. In the session-drafting step (either role), open the exercise picker and
   confirm **Biceps**, **Triceps** and **Core** groups appear alongside the
   original four, each with at least 3 exercises.

- [ ] **Step 5: Update the ledger**

Append an entry to `.superpowers/sdd/progress.md` recording this merge,
following the format of the `HOTFIX-SECURITY-INTEGRITY MERGED` and `PHASE 5A
MERGED` entries already there (merge commit, files/stat, what it covers, any
findings from Davide's manual pass, `RESUME HERE` and the updated queue —
remove item 1, "member-side workout-creation UX," from the previous entry's
queue, since this plan is exactly that item).
