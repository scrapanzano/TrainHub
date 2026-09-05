// Run with:  node src/features/progress/progress.selfcheck.js
import assert from 'node:assert/strict'
import { runDurationMs, weeklyTraining, workoutWeekSummary } from './progress.js'

// Noon local on purpose: a timestamp near midnight lands on a different
// calendar day depending on the machine's zone, and these assertions must hold
// wherever they run.
const at = (year, month, day, hour = 12) =>
  new Date(year, month - 1, day, hour, 0, 0, 0).toISOString()

const TODAY = '2026-07-29'

// The same session repeated counts once; partial and abandoned do not.
// 29 July 2026 is Wednesday, so the ISO week starts Monday 27 July.
const runs = [
  { session_id: 'a', started_at: at(2026, 7, 29, 9), outcome: 'completed' },
  { session_id: 'a', started_at: at(2026, 7, 29, 10), outcome: 'partial' },
  { session_id: 'b', started_at: at(2026, 7, 27), outcome: 'partial' },
  { session_id: 'c', started_at: at(2026, 7, 28), outcome: 'abandoned' },
  { session_id: 'd', started_at: at(2026, 7, 26), outcome: 'completed' },
]

const week = weeklyTraining(runs, 4, TODAY)
assert.equal(week.done, 0)
assert.equal(week.total, 4)
assert.deepEqual(week.days, [])

// Monday is inclusive; the previous Sunday is outside this ISO week.
assert.equal(weeklyTraining([
  { session_id: 'a', started_at: at(2026, 7, 27), outcome: 'completed' },
], 4, TODAY).done, 1)
assert.equal(weeklyTraining([
  { session_id: 'a', started_at: at(2026, 7, 26), outcome: 'completed' },
], 4, TODAY).done, 0)

// A client who trained more days than their plan has sessions is not a bug, but
// the ring must not overflow: `done` is honest, the ratio is clamped.
const over = weeklyTraining(
  ['a', 'b', 'c', 'd', 'e'].map((session_id) => ({
    session_id,
    started_at: at(2026, 7, 29),
    outcome: 'completed',
  })),
  3,
  TODAY,
)
assert.equal(over.done, 5)
assert.equal(over.total, 3)
assert.equal(over.days.length, 3, 'the ring never draws more dots than the plan has sessions')

// Nothing logged, and a client with no plan, both have to render.
assert.deepEqual(weeklyTraining([], 4, TODAY), { done: 0, total: 4, days: [] })
assert.deepEqual(weeklyTraining([], 0, TODAY), { done: 0, total: 0, days: [] })

// The newest attempt decides the status of one session. Abandoned runs stay
// out of the achieved count, and an old open run is still surfaced to the PT.
const summary = workoutWeekSummary([
  { session_id: 'a', started_at: at(2026, 7, 29, 10), ended_at: at(2026, 7, 29, 11), outcome: 'partial' },
  { session_id: 'a', started_at: at(2026, 7, 28), ended_at: at(2026, 7, 28, 13), outcome: 'completed' },
  { session_id: 'b', started_at: at(2026, 7, 27), ended_at: at(2026, 7, 27, 13), outcome: 'completed' },
  { session_id: 'c', started_at: at(2026, 7, 29, 9), ended_at: at(2026, 7, 29, 9), outcome: 'abandoned' },
  { session_id: 'open', started_at: at(2026, 7, 26), ended_at: null, outcome: null },
], 4, TODAY)
assert.equal(summary.weekStart, '2026-07-27')
assert.equal(summary.weekEnd, '2026-08-02')
assert.equal(summary.completed, 1)
assert.equal(summary.partial, 1)
assert.equal(summary.todo, 2)
assert.equal(summary.done, 1)
assert.equal(summary.percent, 25)
assert.equal(summary.openRun.session_id, 'open')
assert.equal(summary.lastRun.session_id, 'a')

assert.equal(runDurationMs({
  started_at: at(2026, 7, 29, 10),
  ended_at: at(2026, 7, 29, 11),
  paused_total_ms: 600_000,
}), 3_000_000)
assert.equal(runDurationMs({ started_at: at(2026, 7, 29), ended_at: null }), null)

console.log('progress.selfcheck OK')
