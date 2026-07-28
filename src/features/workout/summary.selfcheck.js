// Run with:  node src/features/workout/summary.selfcheck.js
import assert from 'node:assert/strict'
import { POINTS, pointsForWorkout, rewardProgress, summariseSession } from './summary.js'

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

console.log('summary: OK')
