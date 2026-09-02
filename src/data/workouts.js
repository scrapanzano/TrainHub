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
    .select('id, name, goal, level, weeks, expires_on, created_at, replaces_plan_id, author:profiles!workout_plans_author_id_fkey ( id, full_name )')
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
 * The caller supplies `id` as an idempotency key. The secure operation accepts
 * an exact replay but rejects reuse of that id for different set content.
 *
 * The caller supplies `performedAt` for the same reason.  This write can sit
 * paused for hours and land on reconnect; leaving it to the column's `now()`
 * default would stamp a set performed at 18:00 as happening at 23:00.
 *
 * `runId` is what scopes the count to one attempt.  It is a foreign key, so
 * this write and `startRun` share a `scope` in `src/data/mutations.js` -- a
 * parallel replay could otherwise land the set before the run it references.
 */
export async function logSet({ id, runId, sessionExerciseId, setNumber, reps, weight, performedAt }) {
  const { data, error } = await supabase
    .rpc('log_workout_set_secure', {
      p_id: id,
      p_run_id: runId,
      p_session_exercise_id: sessionExerciseId,
      p_set_number: setNumber,
      p_reps: reps,
      p_weight: weight ?? null,
      p_performed_at: performedAt,
    })
    .single()

  if (error) throw error
  return data
}

/** The shared exercise catalogue, for the builder's picker. */
export async function fetchExerciseCatalogue() {
  const { data, error } = await supabase
    .from('exercises')
    .select('id, name, muscle_group, equipment')
    // MUI's `groupBy` on the picker's Autocomplete requires the options to
    // already be sorted by the grouping key, or the same group renders as
    // several disjoint sections.
    .order('muscle_group')
    .order('name')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

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
