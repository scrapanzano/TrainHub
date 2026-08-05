// Run with:  node src/features/workout/summary.selfcheck.js
import assert from 'node:assert/strict'
import {
  POINTS, countsByExercise, pointsForRun, pointsForWorkout, rewardProgress, summariseSession,
} from './summary.js'

const exercises = [
  { id: 'a', target_sets: 3 },
  { id: 'b', target_sets: 2 },
]

assert.deepEqual(summariseSession([], []), {
  exerciseCount: 0,
  completedCount: 0,
  setCount: 0,
  totalReps: 0,
  volumeKg: 0,
  allComplete: false,
})

assert.deepEqual(
  summariseSession(exercises, [
    { session_exercise_id: 'a', reps: 10, weight: 60 },
    { session_exercise_id: 'a', reps: 8, weight: 60 },
    { session_exercise_id: 'a', reps: 8, weight: 60 },
    { session_exercise_id: 'b', reps: 12, weight: null },
  ]),
  {
    exerciseCount: 2,
    completedCount: 1,
    setCount: 4,
    totalReps: 38,
    // 10*60 + 8*60 + 8*60 = 1560.  The bodyweight set adds reps, not volume.
    volumeKg: 1560,
    allComplete: false,
  },
)

// Every prescription met.
assert.equal(
  summariseSession(exercises, [
    { session_exercise_id: 'a', reps: 1, weight: 1 },
    { session_exercise_id: 'a', reps: 1, weight: 1 },
    { session_exercise_id: 'a', reps: 1, weight: 1 },
    { session_exercise_id: 'b', reps: 1, weight: 1 },
    { session_exercise_id: 'b', reps: 1, weight: 1 },
  ]).allComplete,
  true,
)

// Logs pointing at an exercise no longer in the session must not crash or
// inflate completedCount -- a trainer can remove an exercise after it was
// logged, and the cascade only fires on delete of the parent row.
assert.equal(
  summariseSession(exercises, [{ session_exercise_id: 'gone', reps: 5, weight: 20 }]).completedCount,
  0,
)

// Fractional plate weights must not accumulate float noise into the display.
assert.equal(
  summariseSession([{ id: 'a', target_sets: 1 }], [{ session_exercise_id: 'a', reps: 3, weight: 2.5 }])
    .volumeKg,
  7.5,
)

assert.deepEqual(POINTS, { checkin: 10, workout: 30, referral: 60 })
assert.equal(pointsForWorkout(), 30)

assert.deepEqual(rewardProgress(1020, [{ points: 1000 }, { points: 1100 }]), {
  total: 1020,
  next: 1100,
  remaining: 80,
  percent: 92,
})
// Nothing left to earn: no next reward, nothing remaining, bar full.
assert.deepEqual(rewardProgress(1200, [{ points: 1000 }]), {
  total: 1200,
  next: null,
  remaining: 0,
  percent: 100,
})
// No rewards defined at all must not divide by zero.
assert.deepEqual(rewardProgress(0, []), { total: 0, next: null, remaining: 0, percent: 100 })

// --- countsByExercise -----------------------------------------------------
assert.deepEqual(countsByExercise([]), {})
// A run with no logs is a real state: the member opened it and logged nothing.
assert.deepEqual(countsByExercise(undefined), {})
assert.deepEqual(
  countsByExercise([
    { session_exercise_id: 'a' },
    { session_exercise_id: 'a' },
    { session_exercise_id: 'b' },
  ]),
  { a: 2, b: 1 },
)

// --- pointsForRun ---------------------------------------------------------
const two = [{ id: 'a', target_sets: 3 }, { id: 'b', target_sets: 3 }]

// Nothing logged is nothing earned.  This is the defect found on device: the
// old code minted the full 30 points for an untouched session.
assert.equal(pointsForRun(two, {}), 0)
// Everything logged is the full award.
assert.equal(pointsForRun(two, { a: 3, b: 3 }), 30)
// Half the sets, half the points.
assert.equal(pointsForRun(two, { a: 3, b: 0 }), 15)
// Floor, not round: 4 of 6 sets is 20, and floor keeps the award from ever
// overstating the work.
assert.equal(pointsForRun(two, { a: 3, b: 1 }), 20)
// 5 of 6 is 25, not 30 -- a near-complete session must not read as complete.
assert.equal(pointsForRun(two, { a: 3, b: 2 }), 25)
// Extra sets cannot inflate the award past the prescription.
assert.equal(pointsForRun(two, { a: 9, b: 9 }), 30)
// A count for an exercise no longer in the session is ignored, not added.
assert.equal(pointsForRun(two, { a: 3, b: 3, ghost: 5 }), 30)
// An empty session cannot divide by zero.
assert.equal(pointsForRun([], {}), 0)
// Nor can one whose exercises prescribe nothing.
assert.equal(pointsForRun([{ id: 'a', target_sets: 0 }], { a: 2 }), 0)
// Missing arguments must yield 0, not NaN: NaN points would be written to the
// rewards table and poison every later total.
assert.equal(pointsForRun(undefined, undefined), 0)

console.log('summary: OK')
