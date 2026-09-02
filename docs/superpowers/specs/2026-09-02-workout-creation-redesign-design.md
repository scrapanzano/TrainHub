# Workout plan creation: multi-session wizard, replace-only editing, catalogue expansion

## Context

`hotfix-security-integrity` (merged, `e887aab`) and its follow-up
(`patches/017`, member self-authorship) restored dual-role plan creation but
left the creation UX as a single-session, two-step form — a plan's first
session is the only one created with it; anything more requires a separate
"Add a session" step reached after the plan already exists.

Davide wrote `doc/create_workout.md`, specifying a richer creation flow: a
member or professional drafts an arbitrary number of sessions in one guided
pass, reviews and edits them in a summary before anything is written, and
only then commits the whole plan atomically. The doc also raises, and this
design resolves, three open questions: whether an existing plan should be
editable in place, whether exercise media (image/video) belongs in this pass,
and how to grow the exercise catalogue.

Resolved during brainstorming, with evidence from the current codebase:

- **Editable in place: no.** `fetchRunsSince(memberId, ...)` (`src/data/
  runs.js`) scopes a client's training history by member, not by plan or
  session, and `WorkoutRunDetailScreen.jsx` fetches a run by its own id — so a
  plan replacement (`replaces_plan_id`, already built) never hides or
  reinterprets past training. `add_session_exercise_secure` (`patches/015`)
  already forbids changing any session that has run history. In-place editing
  would be the one to introduce a data-integrity risk here (rewriting what a
  past run was performed against), not the thing preventing one. This
  confirms and completes the "replace-only" model already merged: no path may
  add a session or exercise to a plan that already exists, even before that
  session has been run. The gaps found and being closed by this design:
  `ClientWorkoutScreen.jsx`'s "Add a session" and per-session "Add exercise"
  buttons, both still reachable for the professional against an existing plan.
- **Exercise image/video: no, keep the existing decision.**
  `ExerciseDetailScreen.jsx` already documents why `exercises.image_url` is
  unused (PWA precache size, licensing, instructions already suffice) — not
  reopened here.
- **Old plan retention:** already solved by `replaces_plan_id`; no new work.

## 1. `CreatePlanFlow.jsx`: multi-session wizard

Replaces the current two-step (`meta` → one `SessionForm` → submit) with a
three-step local state machine. Nothing is written to the server until the
final step.

```
step: 'meta' | 'session' | 'summary'
draft: {
  meta: { name, goal, level, weeks } | null,
  sessions: Array<{ id, name, exercises }>,   // client-generated ids, uuid.js
  editingIndex: number | null,                // set when reopening a drafted session
}
```

- **`meta`** — the existing `PlanForm.jsx`, unchanged.
- **`session`** — the existing `SessionForm.jsx`, unchanged. Confirming a
  session appends it to `draft.sessions` (or replaces the entry at
  `editingIndex`, when reopened from the summary) — this is a local state
  update, not a mutation — then goes straight to `summary`.
- **`summary`** — new. Lists each drafted session (name, exercise count) with
  **Edit** (reopens `session` pre-filled at that index) and **Delete**
  (confirmation dialog, same `window.confirm` pattern used elsewhere in this
  codebase, e.g. `WorkoutPlanScreen.jsx`'s old delete flow). Actions: **Add
  another session** (back to `session`, `editingIndex: null`), **Confirm &
  create** (fires the single atomic mutation below), **Abandon**
  (confirmation dialog, clears `draft`, navigates back to where the flow was
  entered from).

Deliberate simplification from the doc's free-flow: after confirming a
session, the flow lands directly on `summary` rather than an intermediate
"add another or go to summary" screen — the summary page already offers both
actions, so the interstitial adds a screen without adding a capability.

Abandon is reachable from any step (back/cancel), always behind the same
confirmation dialog, and never touches a plan that already exists — a plan
under construction lives only in `draft` until the final atomic write.

`ClientWorkoutScreen.jsx` and `NewPlanScreen.jsx` both mount `CreatePlanFlow`
exactly as they do today (`memberId`, optional `replacesPlanId`, `onDone`);
neither needs a structural change beyond the removals in section 3.

## 2. SQL: patch `018-multi-session-plan-creation.sql`

`create_workout_plan_secure`'s trailing three parameters
(`p_session_id uuid, p_session_name text, p_exercises jsonb`) become one
`p_sessions jsonb` — an array of `{id, name, position, exercises}`. The
function loops over it, calling the existing `public._insert_session_bundle`
(`patches/015`) once per element inside the same transaction it already
runs in — no new helper, no schema change, atomicity is unchanged (a
`plpgsql` function body is already one transaction). The replay/idempotency
check (comparing an existing row's stored values against the incoming call)
extends to compare the sessions array the same way it compares `name`,
`goal`, etc.

`src/data/workouts.js`'s `createPlan()` changes its signature to match:
`sessions: [{ id, name, exercises }]` replaces `sessionId, sessionName,
exercises`. `CreatePlanFlow.jsx` builds that array from `draft.sessions` at
submit time, running each through the existing
`buildSessionExercisePayloads()` (`contracts.js`) and assigning `position` as
the array index + 1.

`create_workout_session_secure` is untouched by this patch (still exists,
still unreachable from the UI after section 3 — see the merge conversation's
note on leaving it in place; no product invariant is closed at the database
level by this pass, Davide is handling that separately before submission).

## 3. Removals: closing the in-place-editing gap

- `ClientWorkoutScreen.jsx`: the "Add a session" button and its inline
  `SessionForm` block (`createSession` mutation), and the per-session "Add
  exercise" button. The screen, once a plan exists, becomes read-only plus
  "Create replacement plan" — net removal of code, not addition.
- `src/features/workout/AddExerciseScreen.jsx` — deleted (its route,
  `clients/:clientId/workout/session/:sessionId/exercise/new`, removed from
  `src/routes/index.jsx`).
- `src/features/workout/AddSessionScreen.jsx` — deleted. Already unreachable
  today: no route in `src/routes/index.jsx` points to it (the member route
  was redirected away in `patches/015`; no professional route ever loaded it).
- `mutationKeys.createSession` and `mutationKeys.addSessionExercise`
  (`src/lib/mutationKeys.js`), their registrations in `src/data/mutations.js`,
  and the now-uncalled `createSession()`/`addSessionExercise()` in
  `src/data/workouts.js`.

## 4. Exercise catalogue expansion

Grows from 4 muscle groups (Chest, Legs, Back, Shoulders; 10 exercises) to 7
(adding Biceps, Triceps, Core), 3-4 exercises each. `muscle_group` is free
text with no schema constraint (`Autocomplete`'s `groupBy` reads it
directly), so this is content, not schema: new rows appended to `seed.sql`
(fresh installs) and inserted via this same patch or a small dedicated one
into the shared demo database, `on conflict (name) do nothing` — the pattern
`seed.sql` already uses.

## 5. Visual pass

Deferred to `/impeccable` once this spec's flow and copy are settled and
built — not part of this implementation plan. Context to hand it when that
happens: the wireframes under `doc/assets/gym_member/**` and `doc/assets/
pt/**`, the tokens in `doc/assets/variables.tokens.json`, and the existing
`PlanForm.jsx`/`SessionForm.jsx` as the app's current style baseline for this
exact flow.
