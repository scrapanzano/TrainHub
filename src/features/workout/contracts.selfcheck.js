// Run with: node src/features/workout/contracts.selfcheck.js
import assert from 'node:assert/strict'
import { buildSessionExercisePayloads, buildSessionPayloads } from './contracts.js'

let nextId = 0
const createId = () => `exercise-${++nextId}`
const draft = [
  { exerciseId: 'catalogue-a', position: 1, targetSets: 3, targetReps: 10 },
  {
    id: 'stable-id', exerciseId: 'catalogue-b', position: 2,
    targetSets: 4, targetReps: 8, targetWeight: 22.5, restSeconds: 120, notes: 'Slow tempo',
  },
]

assert.deepEqual(buildSessionExercisePayloads(draft, createId), [
  {
    id: 'exercise-1', exercise_id: 'catalogue-a', position: 1,
    target_sets: 3, target_reps: 10, target_weight: null, rest_seconds: 90, notes: null,
  },
  {
    id: 'stable-id', exercise_id: 'catalogue-b', position: 2,
    target_sets: 4, target_reps: 8, target_weight: 22.5, rest_seconds: 120,
    notes: 'Slow tempo',
  },
])

// Reusing an already-frozen payload never calls the ID factory again. This is
// the property a persisted offline replay depends on.
const frozen = buildSessionExercisePayloads(draft, createId)
assert.equal(frozen[1].id, 'stable-id')
assert.equal(nextId, 2)
assert.deepEqual(buildSessionExercisePayloads([], createId), [])

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

console.log('workout contracts: OK')
