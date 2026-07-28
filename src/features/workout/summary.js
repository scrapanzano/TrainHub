// Pure arithmetic for the post-session summary and the rewards screen.
// No imports, so the self-check runs under bare Node.

/** The points table the Rewards screen also prints for the member. */
export const POINTS = { checkin: 10, workout: 30, referral: 60 }

export function pointsForWorkout() {
  return POINTS.workout
}

/**
 * Roll one session's logs up into the numbers the summary shows.
 *
 * `volumeKg` is reps x weight summed -- the usual training measure. A set with
 * no weight is a bodyweight set: it counts towards reps and set count but
 * contributes no volume, which is right, not a gap.
 */
export function summariseSession(exercises, logs) {
  const perExercise = new Map(exercises.map((exercise) => [exercise.id, 0]))

  let setCount = 0
  let totalReps = 0
  let volume = 0

  for (const log of logs) {
    setCount += 1
    totalReps += log.reps ?? 0
    volume += (log.reps ?? 0) * (log.weight ?? 0)

    // A log can outlive the exercise it belongs to only if the row was edited
    // rather than deleted, but guarding costs one branch and a crash here would
    // take down the screen that celebrates the workout.
    if (perExercise.has(log.session_exercise_id)) {
      perExercise.set(log.session_exercise_id, perExercise.get(log.session_exercise_id) + 1)
    }
  }

  const completedCount = exercises.filter(
    (exercise) => perExercise.get(exercise.id) >= exercise.target_sets,
  ).length

  return {
    exerciseCount: exercises.length,
    completedCount,
    setCount,
    totalReps,
    // Two decimals: 2.5 kg plates are real, and float addition otherwise
    // surfaces 1559.9999999999998 on a summary screen.
    volumeKg: Math.round(volume * 100) / 100,
    allComplete: exercises.length > 0 && completedCount === exercises.length,
  }
}

/**
 * Where the member stands against the next reward they have not yet earned.
 *
 * `rewards` is the catalogue of what can be claimed, each with a `points` cost.
 */
export function rewardProgress(totalPoints, rewards) {
  const costs = rewards.map((reward) => reward.points).sort((a, b) => a - b)
  const next = costs.find((cost) => cost > totalPoints) ?? null

  // Nothing further to reach for is a full bar, not an empty one -- and it
  // avoids dividing by a `next` that does not exist.
  if (next === null) return { total: totalPoints, next: null, remaining: 0, percent: 100 }

  return {
    total: totalPoints,
    next,
    remaining: next - totalPoints,
    // Floor, not round: `percent: 100` is reserved for the branch above where
    // there is nothing left to earn.  Rounding would let 1099 out of 1100 read
    // as a full bar for a reward the member has not actually reached.
    percent: Math.floor((totalPoints / next) * 100),
  }
}
