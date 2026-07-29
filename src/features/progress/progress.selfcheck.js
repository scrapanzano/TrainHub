// Run with:  node src/features/progress/progress.selfcheck.js
import assert from 'node:assert/strict'
import { weeklyTraining, weightTrend } from './progress.js'

// Noon local on purpose: a timestamp near midnight lands on a different
// calendar day depending on the machine's zone, and these assertions must hold
// wherever they run.
const at = (year, month, day, hour = 12) =>
  new Date(year, month - 1, day, hour, 0, 0, 0).toISOString()

const TODAY = '2026-07-29'

// Two sets on the same day are one training day, not two.  This is the whole
// point of counting distinct days rather than logs.
const logs = [
  { performed_at: at(2026, 7, 29, 9), reps: 10, weight: 60 },
  { performed_at: at(2026, 7, 29, 10), reps: 8, weight: 60 },
  { performed_at: at(2026, 7, 27), reps: 10, weight: 80 },
  { performed_at: at(2026, 7, 23), reps: 12, weight: 40 },
  // Eight days back: outside the window, and the boundary that an off-by-one
  // would quietly include.
  { performed_at: at(2026, 7, 21), reps: 12, weight: 40 },
]

const week = weeklyTraining(logs, 4, TODAY)
assert.equal(week.done, 3)
assert.equal(week.total, 4)
assert.deepEqual(week.days, ['2026-07-23', '2026-07-27', '2026-07-29'])

// The far edge of the window is inclusive: exactly seven days back counts.
assert.equal(weeklyTraining([{ performed_at: at(2026, 7, 23) }], 4, TODAY).done, 1)
// One day further is not.
assert.equal(weeklyTraining([{ performed_at: at(2026, 7, 22) }], 4, TODAY).done, 0)

// A client who trained more days than their plan has sessions is not a bug, but
// the ring must not overflow: `done` is honest, the ratio is clamped.
const over = weeklyTraining(
  [at(2026, 7, 29), at(2026, 7, 28), at(2026, 7, 27), at(2026, 7, 26), at(2026, 7, 25)].map(
    (performed_at) => ({ performed_at }),
  ),
  3,
  TODAY,
)
assert.equal(over.done, 5)
assert.equal(over.total, 3)
assert.equal(over.days.length, 3, 'the ring never draws more dots than the plan has sessions')

// Nothing logged, and a client with no plan, both have to render.
assert.deepEqual(weeklyTraining([], 4, TODAY), { done: 0, total: 4, days: [] })
assert.deepEqual(weeklyTraining([], 0, TODAY), { done: 0, total: 0, days: [] })

// Weight: newest first, as the query returns it.  Losing weight is 'down'.
const metrics = [
  { measured_on: '2026-07-29', weight_kg: 78.5 },
  { measured_on: '2026-07-22', weight_kg: 79 },
  { measured_on: '2026-07-15', weight_kg: 79.5 },
]
assert.deepEqual(weightTrend(metrics), {
  current: 78.5,
  deltaKg: -0.5,
  direction: 'down',
  measuredOn: '2026-07-29',
})

// Gaining reads 'up'; the delta keeps its sign either way.
assert.deepEqual(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: 80 },
    { measured_on: '2026-07-22', weight_kg: 79 },
  ]),
  { current: 80, deltaKg: 1, direction: 'up', measuredOn: '2026-07-29' },
)

// Float subtraction: 78.5 - 78.4 is 0.09999999999999432 in binary floating
// point, and a screen must not print that.
assert.equal(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: 78.5 },
    { measured_on: '2026-07-22', weight_kg: 78.4 },
  ]).deltaKg,
  0.1,
)

// Identical readings are flat, not a rounding artefact in either direction.
assert.equal(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: 78.5 },
    { measured_on: '2026-07-22', weight_kg: 78.5 },
  ]).direction,
  'flat',
)

// A single reading has a current weight but no trend, and must not report 0 --
// "no change" and "nothing to compare" are different answers.
assert.deepEqual(weightTrend([{ measured_on: '2026-07-29', weight_kg: 78.5 }]), {
  current: 78.5,
  deltaKg: null,
  direction: null,
  measuredOn: '2026-07-29',
})

// A note-only check-in leaves weight_kg null; it must be skipped when looking
// for something to compare, not treated as zero kilos.
assert.deepEqual(
  weightTrend([
    { measured_on: '2026-07-29', weight_kg: null },
    { measured_on: '2026-07-22', weight_kg: 79 },
    { measured_on: '2026-07-15', weight_kg: 79.5 },
  ]),
  { current: 79, deltaKg: -0.5, direction: 'down', measuredOn: '2026-07-22' },
)

assert.deepEqual(weightTrend([]), {
  current: null,
  deltaKg: null,
  direction: null,
  measuredOn: null,
})

console.log('progress.selfcheck OK')
