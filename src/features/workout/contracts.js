import { createUuid } from '../../lib/uuid.js'

/**
 * Freeze a session draft into the JSON contract consumed by patch 015.
 *
 * IDs are created before the mutation is queued. That makes an offline replay
 * send the exact same exercise rows instead of inventing new IDs on every
 * attempt.
 */
export function buildSessionExercisePayloads(exercises, createId = createUuid) {
  return (exercises ?? []).map((item) => ({
    id: item.id ?? createId(),
    exercise_id: item.exerciseId,
    position: item.position,
    target_sets: item.targetSets,
    target_reps: item.targetReps,
    target_weight: item.targetWeight ?? null,
    rest_seconds: item.restSeconds ?? 90,
    notes: item.notes || null,
  }))
}
