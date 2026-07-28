import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which is
// the right call for a transient 503 and the wrong one for a phone in a gym
// basement: it turns "offline" into seven seconds of nothing. Retry only when
// the browser thinks there is a network, so the transient-error handling is
// kept and the offline path fails immediately. Applied to every read below.

// PostgREST embeds related rows through the foreign keys already declared in
// schema.sql.  `set_logs(count)` is an embedded aggregate: it returns how many
// set_logs point at each session_exercise without shipping the rows.  Row Level
// Security scopes that count to the signed-in member automatically, so no
// member_id filter is needed -- and adding one would not make it safer.
const SESSION_EXERCISE_COLUMNS = `
  id, position, target_sets, target_reps, target_weight, rest_seconds, notes,
  exercise:exercises ( id, name, muscle_group, equipment, instructions, video_url, image_url ),
  set_logs ( count )
`

// PostgREST returns an embedded count as `[{ count: n }]`, or `[]` when nothing
// matches.  Flatten it here so no screen has to know that shape.
const withLoggedCount = (row) => {
  const { set_logs: logs, ...rest } = row
  return { ...rest, loggedCount: logs?.[0]?.count ?? 0 }
}

/**
 * The member's current plan and its sessions.
 *
 * A member can hold several plans over time; "current" is the most recently
 * created one.  Returns null rather than throwing when there is none, because
 * a member who has not been assigned a plan yet is an ordinary state that the
 * Home and Workout screens both render as an empty state.
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

  return {
    plan,
    sessions: (sessions ?? []).map(({ session_exercises: exercises, ...session }) => ({
      ...session,
      exerciseCount: exercises?.[0]?.count ?? 0,
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
    exercises: (exercises ?? []).map(withLoggedCount).sort((a, b) => a.position - b.position),
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
  return withLoggedCount(data)
}

/** Every set the member has logged in one session. */
export async function fetchSessionLogs(sessionId) {
  const { data, error } = await supabase
    .from('set_logs')
    // `!inner` turns the embed into an inner join, which is what lets the filter
    // below reach through to the parent session.  RLS still scopes the rows to
    // this member on top of it.
    .select(
      'id, session_exercise_id, set_number, reps, weight, performed_at, session_exercises!inner ( session_id )',
    )
    .eq('session_exercises.session_id', sessionId)
    .order('performed_at')
    .retry(navigator.onLine)

  if (error) throw error
  // Return only the log's own columns; the joined `session_exercises` row exists
  // solely so the filter above can reach the parent session.
  return (data ?? []).map(({ id, session_exercise_id, set_number, reps, weight, performed_at }) => ({
    id,
    session_exercise_id,
    set_number,
    reps,
    weight,
    performed_at,
  }))
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
 */
export async function logSet({
  id,
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

/**
 * Move a session between `todo`, `in_progress` and `completed`.
 *
 * Idempotent by nature: setting a status it already holds writes the same value.
 */
export async function setSessionStatus({ sessionId, status }) {
  const { data, error } = await supabase
    .from('workout_sessions')
    .update({ status })
    .eq('id', sessionId)
    .select('id, status')
    .single()

  if (error) throw error
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
