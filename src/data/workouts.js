import { supabase } from '../lib/supabase.js'

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

  if (planError) throw planError
  if (!plan) return null

  const { data: sessions, error: sessionsError } = await supabase
    .from('workout_sessions')
    .select('id, name, position, status, session_exercises ( count )')
    .eq('plan_id', plan.id)
    .order('position')

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

  if (error) throw error
  return withLoggedCount(data)
}
