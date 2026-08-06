import { supabase } from '../lib/supabase.js'

// One row per attempt at a workout session.  See supabase/patches/013.
//
// Reads carry `.retry(navigator.onLine)`: postgrest otherwise retries a failed
// GET three times with 1s/2s/4s backoff, turning "offline" into seven seconds of
// blank screen in exactly the gym basement this feature exists for.  Writes
// deliberately do NOT -- they are meant to pause and be replayed by
// `resumePausedMutations`.

// `pct` arrives with patches/014.  Until that patch is applied every read here
// answers "column workout_runs.pct does not exist" -- 013 alone is not enough.
const RUN_COLUMNS =
  'id, session_id, member_id, started_at, paused_at, paused_total_ms, ended_at, outcome, pct, note'

/**
 * The member's open workout, if there is one.
 *
 * Answers two questions with one read: what the mini-player shows on every
 * screen, and whether pressing play on another session must first ask about
 * this one.
 *
 * `maybeSingle` rather than `single` because having nothing open is the
 * ordinary case, not an error -- and the partial unique index in `patches/013`
 * guarantees there is never more than one row to choose between.
 */
export async function fetchOpenRun(memberId) {
  const { data, error } = await supabase
    .from('workout_runs')
    .select(`${RUN_COLUMNS}, session:workout_sessions ( id, name, plan_id )`)
    .eq('member_id', memberId)
    .is('ended_at', null)
    .maybeSingle()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/**
 * One run by id, with enough of its session to title a screen.
 *
 * `maybeSingle`, not `single`: a member reloading the summary of a run whose
 * session has since been deleted should meet an empty state, not a thrown
 * error on a screen that exists to celebrate something.
 */
export async function fetchRun(runId) {
  const { data, error } = await supabase
    .from('workout_runs')
    .select(`${RUN_COLUMNS}, session:workout_sessions ( id, name, plan_id )`)
    .eq('id', runId)
    .maybeSingle()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/**
 * Every run this member started on or after `sinceISO`, newest first.
 *
 * One read for the whole plan rather than one per session: a plan holds a
 * handful of sessions and a fortnight holds a handful of runs, so grouping in
 * the caller costs nothing and saves a round trip per card.
 */
export async function fetchRunsSince(memberId, sinceISO) {
  const { data, error } = await supabase
    .from('workout_runs')
    .select(RUN_COLUMNS)
    .eq('member_id', memberId)
    // A bare 'YYYY-MM-DD' compares correctly against a timestamptz: Postgres
    // casts it to midnight of that day in the connection's zone.
    .gte('started_at', sinceISO)
    .order('started_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * The sets logged inside one run.
 *
 * This is what makes the `2/3` pills restart every week and after every
 * abandon: the count is scoped to one attempt rather than to all of history.
 * The lifetime count it replaces would have read `6/3` in week two, and nothing
 * would ever have completed again.
 */
export async function fetchRunLogs(runId) {
  const { data, error } = await supabase
    .from('set_logs')
    .select('id, session_exercise_id, set_number, reps, weight, performed_at')
    .eq('run_id', runId)
    .order('performed_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Open a workout.
 *
 * The caller supplies `id` and `startedAt`.  The id is the idempotency key: a
 * replayed insert must land on the same row rather than open a second run and
 * trip `workout_runs_one_open_per_member`.  The timestamp is the caller's
 * because this write can sit paused for hours -- the database's clock at insert
 * time would record an 18:00 workout as starting at 23:00.
 *
 * `ignoreDuplicates` is correct here because this function is insert-only.  The
 * three below are the edit path and must not use it, or every correction to a
 * run would be a silent no-op.
 */
export async function startRun({ id, sessionId, memberId, startedAt }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .upsert(
      { id, session_id: sessionId, member_id: memberId, started_at: startedAt },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select(RUN_COLUMNS)
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success, not a gap.
  return data
}

/** Freeze the clock. */
export async function pauseRun({ id, pausedAt }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .update({ paused_at: pausedAt })
    .eq('id', id)
    .select(RUN_COLUMNS)
    .single()

  if (error) throw error
  return data
}

/**
 * Restart the clock, crediting the paused stretch.
 *
 * The caller computes `pausedTotalMs` with `resumeTimer` from `timer.js`, which
 * clamps a backwards clock correction: a negative total is subtracted from
 * every later reading and would inflate the clock permanently rather than once.
 */
export async function resumeRun({ id, pausedTotalMs }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .update({ paused_at: null, paused_total_ms: pausedTotalMs })
    .eq('id', id)
    .select(RUN_COLUMNS)
    .single()

  if (error) throw error
  return data
}

/**
 * Close a workout.
 *
 * `outcome` is 'completed', 'partial' or 'abandoned'.  Writing `ended_at` is
 * what releases the partial unique index and lets the member start something
 * else, so it is never left null on a run the member has finished with.
 *
 * `pct` is stamped here rather than derived later, from the same ratio the
 * points come from, so the plan card and the reward cannot tell opposite
 * stories about the same workout.
 *
 * The note is NOT written here -- it is asked for afterwards, on the summary,
 * and has its own `saveRunNote`.  Sending it from here would mean a screen that
 * only knows what the member typed also re-sending the outcome.
 *
 * Idempotent by nature: closing an already-closed run writes the same values,
 * which is what makes it safe to replay after a reconnect.
 */
export async function endRun({ id, endedAt, outcome, pct }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .update({ ended_at: endedAt, outcome, pct: pct ?? null })
    .eq('id', id)
    .select(RUN_COLUMNS)
    .single()

  if (error) throw error
  return data
}

/**
 * Attach the member's note to a run that is already closed.
 *
 * Separate from `endRun` because the note is written on the summary screen,
 * after the run has ended -- folding it into `endRun` would mean re-sending
 * `ended_at` and `outcome` from a screen that has no business deciding either.
 */
export async function saveRunNote({ id, note }) {
  const { data, error } = await supabase
    .from('workout_runs')
    .update({ note: note || null })
    .eq('id', id)
    .select(RUN_COLUMNS)
    .single()

  if (error) throw error
  return data
}
