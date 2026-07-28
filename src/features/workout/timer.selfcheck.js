// Run with:  node src/features/workout/timer.selfcheck.js
import assert from 'node:assert/strict'
import { elapsedMs, formatElapsed, isPaused, pauseTimer, resumeTimer, startTimer } from './timer.js'

const T0 = 1_000_000

const started = startTimer(T0)
assert.deepEqual(started, { startedAt: T0, pausedAt: null, pausedTotal: 0 })
assert.equal(isPaused(started), false)
assert.equal(elapsedMs(started, T0), 0)
assert.equal(elapsedMs(started, T0 + 5000), 5000)

// Pausing freezes the clock: elapsed must not advance while paused.
const paused = pauseTimer(started, T0 + 5000)
assert.equal(isPaused(paused), true)
assert.equal(elapsedMs(paused, T0 + 5000), 5000)
assert.equal(elapsedMs(paused, T0 + 60_000), 5000)

// Resuming does not credit the paused stretch.
const resumed = resumeTimer(paused, T0 + 60_000)
assert.equal(isPaused(resumed), false)
assert.equal(elapsedMs(resumed, T0 + 60_000), 5000)
assert.equal(elapsedMs(resumed, T0 + 61_000), 6000)

// Two pause/resume cycles accumulate, they do not overwrite each other.
const paused2 = pauseTimer(resumed, T0 + 61_000)
const resumed2 = resumeTimer(paused2, T0 + 100_000)
assert.equal(elapsedMs(resumed2, T0 + 101_000), 7000)

// Double pause and double resume must be no-ops, not corruption -- a double tap
// on a phone is one event too many, not a reason to lose the workout.
assert.deepEqual(pauseTimer(paused, T0 + 99_999), paused)
assert.deepEqual(resumeTimer(resumed, T0 + 99_999), resumed)

// A clock that went backwards (device time corrected mid-session) must read 0,
// never a negative duration rendered as "-00:00:04".
assert.equal(elapsedMs(started, T0 - 4000), 0)

assert.equal(formatElapsed(0), '00:00:00')
assert.equal(formatElapsed(7000), '00:00:07')
assert.equal(formatElapsed(440_000), '00:07:20')
assert.equal(formatElapsed(3_661_000), '01:01:01')
// Over a day still reads as hours rather than wrapping to zero.
assert.equal(formatElapsed(90_000_000), '25:00:00')

console.log('timer: OK')
