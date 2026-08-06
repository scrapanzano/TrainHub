import { supabase } from '../lib/supabase.js'
import { daysBefore, mondayOf } from '../lib/week.js'
import { todayISO } from '../lib/format.js'
import { fetchRunsSince } from './runs.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which is
// the right call for a transient 503 and the wrong one for a phone in a gym
// basement: it turns "offline" into seven seconds of nothing. Retry only when
// the browser thinks there is a network, so the transient-error handling is
// kept and the offline path fails immediately. Applied to every read below.

// The prescription only.  There was once an embedded `set_logs ( count )`
// aggregate here; it was a LIFETIME count, which is the wrong question the
// moment a session repeats.  In week two a three-set exercise read `6/3` and
// nothing ever completed again.  Counting now happens against one run's logs --
// see `fetchRunLogs` in `./runs.js` and `countsByExercise` in the summary
// module.
const SESSION_EXERCISE_COLUMNS = `
  id, position, target_sets, target_reps, target_weight, rest_seconds, notes,
  exercise:exercises ( id, name, muscle_group, equipment, instructions, video_url, image_url )
`

/**
 * The member's current plan, its sessions, and the runs that give each session
 * a state this week.
 *
 * A member can hold several plans over time; "current" is the most recently
 * created one.  Older plans are archived rather than deleted -- their sessions
 * and logged sets stay attached and keep feeding the professional's progress
 * charts.  Returns null rather than throwing when there is none, because a
 * member who has not been assigned a plan yet is an ordinary state that the
 * Home and Workout screens both render as an empty state.
 *
 * `weekStart` comes back with the data so every screen derives status against
 * the same Monday.  Computed once here rather than per card: a member who opens
 * the app at 23:59:59 on Sunday must not have half the list resolve against one
 * week and half against the next.
 */
export async function fetchActivePlan(memberId) {
  const { data: plan, error: planError } = await supabase
    .from('workout_plans')
    .select('id, name, goal, level, weeks, expires_on, author:profiles!workout_plans_author_id_fkey ( id, full_name )')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .retry(navigator.onLine)

  if (planError) throw planError
  if (!plan) return null

  const { data: sessions, error: sessionsError } = await supabase
    .from('workout_sessions')
    .select('id, name, position, status, session_exercises ( count )')
    .eq('plan_id', plan.id)
    .order('position')
    .retry(navigator.onLine)

  if (sessionsError) throw sessionsError

  const weekStart = mondayOf(todayISO())
  // Read back a fortnight, not a week.  A run left open last Sunday is still
  // open, and `workout_runs_one_open_per_member` blocks starting a new one --
  // so a window that hid it would strand the member with a play button that
  // fails and nothing on screen explaining why.  `runStatusOf` decides what
  // counts for the week; this read only has to not hide anything.
  const runs = await fetchRunsSince(memberId, daysBefore(weekStart, 7))

  return {
    plan,
    weekStart,
    sessions: (sessions ?? []).map(({ session_exercises: exercises, ...session }) => ({
      ...session,
      exerciseCount: exercises?.[0]?.count ?? 0,
      runs: runs.filter((run) => run.session_id === session.id),
    })),
  }
}

/** One session with its prescribed exercises, ordered as the trainer wrote them. */
export async function fetchSession(sessionId) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .select(`id, name, position, status, session_exercises ( ${SESSION_EXERCISE_COLUMNS} )`)
    .eq('id', sessionId)
    .single()
    .retry(navigator.onLine)

  if (error) throw error

  const { session_exercises: exercises, ...session } = data
  return {
    session,
    // PostgREST does not order embedded rows, so sort here rather than trusting
    // insertion order -- the trainer's sequencing is meaningful.
    exercises: (exercises ?? []).sort((a, b) => a.position - b.position),
  }
}

/** One prescribed exercise, plus enough of its session to render a back link. */
export async function fetchSessionExercise(sessionExerciseId) {
  const { data, error } = await supabase
    .from('session_exercises')
    .select(`${SESSION_EXERCISE_COLUMNS}, session:workout_sessions ( id, name )`)
    .eq('id', sessionExerciseId)
    .single()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/**
 * Record one performed set.
 *
 * The caller supplies `id`.  `set_logs.id` has no database default precisely so
 * this can be an upsert that ignores duplicates: `resumePausedMutations` will
 * replay a write whose response never arrived, and a plain insert would fail
 * that replay with a primary-key violation the user would see as a lost set.
 *
 * The caller supplies `performedAt` for the same reason.  This write can sit
 * paused for hours and land on reconnect; leaving it to the column's `now()`
 * default would stamp a set performed at 18:00 as happening at 23:00.
 *
 * `runId` is what scopes the count to one attempt.  It is a foreign key, so
 * this write and `startRun` share a `scope` in `src/data/mutations.js` -- a
 * parallel replay could otherwise land the set before the run it references.
 */
export async function logSet({
  id,
  runId,
  sessionExerciseId,
  memberId,
  setNumber,
  reps,
  weight,
  performedAt,
}) {
  const { data, error } = await supabase
    .from('set_logs')
    .upsert(
      {
        id,
        run_id: runId,
        session_exercise_id: sessionExerciseId,
        member_id: memberId,
        set_number: setNumber,
        reps,
        weight: weight ?? null,
        // Falls back to the caller's clock at call time rather than to the
        // database default, so an omitted argument still cannot drift.
        performed_at: performedAt ?? new Date().toISOString(),
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success, not a gap.
  return data
}

/** The shared exercise catalogue, for the builder's picker. */
export async function fetchExerciseCatalogue() {
  const { data, error } = await supabase
    .from('exercises')
    .select('id, name, muscle_group, equipment')
    .order('name')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Create one session and its exercises.
 *
 * Two statements rather than one, because PostgREST has no transaction across
 * requests: if the second fails the session exists but is empty, which the plan
 * screen already renders as "Plan not ready" rather than crashing.  A stored
 * procedure would make it atomic and is the upgrade if this ever matters.
 */
export async function createSession({ planId, name, position, exercises }) {
  const { data: session, error: sessionError } = await supabase
    .from('workout_sessions')
    .insert({ plan_id: planId, name, position })
    .select('id')
    .single()

  if (sessionError) throw sessionError
  if (exercises.length === 0) return session

  const { error: exercisesError } = await supabase.from('session_exercises').insert(
    exercises.map((item) => ({
      session_id: session.id,
      exercise_id: item.exerciseId,
      position: item.position,
      target_sets: item.targetSets,
      target_reps: item.targetReps,
    })),
  )

  if (exercisesError) throw exercisesError
  return session
}

/**
 * Create a workout plan for a member.
 *
 * A professional reaches this through `workout_plans_write`, which is gated on
 * `owns_member(member_id)` -- so this succeeds for their own clients and is
 * rejected by the database for anyone else's.  `author_id` records who wrote
 * it, which the member's plan screen prints.
 *
 * The caller supplies `id`.  `workout_plans` has no unique constraint besides
 * the primary key, and `fetchActivePlan` takes `created_at desc limit 1`, so a
 * duplicate insert would be invisible rather than loud -- both the global
 * `retry: 3` re-running a lost response and a professional resubmitting after
 * a reload while the first create is still paused offline can produce one.
 * `ignoreDuplicates` is correct here because creating a plan is insert-only:
 * unlike `saveNutritionPlan`, there is no edit path through this function for
 * it to silently no-op.
 */
export async function createPlan({ id, memberId, authorId, name, goal, level, weeks }) {
  const { data, error } = await supabase
    .from('workout_plans')
    .upsert(
      {
        id,
        member_id: memberId,
        author_id: authorId,
        name,
        goal: goal || null,
        level: level || null,
        weeks,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success, not a gap.
  return data
}

/**
 * Delete one session.
 *
 * `session_exercises` and any `set_logs` beneath it cascade.  Idempotent by
 * nature: deleting a row that is already gone affects nothing and does not
 * error, which is what makes it safe to replay after a reconnect.
 */
export async function deleteSession({ sessionId }) {
  const { error } = await supabase.from('workout_sessions').delete().eq('id', sessionId)
  if (error) throw error
}

/**
 * Add one prescribed exercise to a session that already exists.
 *
 * The caller supplies `id` and `position`.  The id makes a replay upsert
 * instead of duplicating -- this write can pause offline and be replayed on
 * reconnect -- and `ignoreDuplicates` is right because there is no edit path
 * through this function for it to silently no-op.
 *
 * `position` must be `Math.max(0, ...) + 1`, never a count: `unique
 * (session_id, position)` rejects a reused one, and counting collides the
 * moment anything has been deleted.
 */
export async function addSessionExercise({
  id, sessionId, exerciseId, position, targetSets, targetReps, targetWeight, restSeconds,
}) {
  const { data, error } = await supabase
    .from('session_exercises')
    .upsert(
      {
        id,
        session_id: sessionId,
        exercise_id: exerciseId,
        position,
        target_sets: targetSets,
        target_reps: targetReps,
        target_weight: targetWeight ?? null,
        rest_seconds: restSeconds,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success, not a gap.
  return data
}

/**
 * Remove one exercise from a session.
 *
 * Any `set_logs` beneath it cascade, which is why the caller confirms first.
 * Idempotent like `deleteSession`: deleting a row that is already gone affects
 * nothing and does not error, so it needs no client-generated id to be safe to
 * replay after a reconnect.
 *
 * The gap it leaves in `position` is deliberate and harmless: positions are
 * only ever read in order, and `unique (session_id, position)` is respected by
 * `Math.max(...) + 1`, never by counting.
 */
export async function deleteSessionExercise({ sessionExerciseId }) {
  const { error } = await supabase.from('session_exercises').delete().eq('id', sessionExerciseId)
  if (error) throw error
}
