// Run with:  node src/features/workout/status.selfcheck.js
import assert from 'node:assert/strict'
import { planProgress, sessionStatusOf, setProgress } from './status.js'

assert.deepEqual(sessionStatusOf('todo'), { label: 'To Do', color: 'error' })
assert.deepEqual(sessionStatusOf('in_progress'), { label: 'In Progress', color: 'warning' })
assert.deepEqual(sessionStatusOf('completed'), { label: 'Completed', color: 'success' })
// A status the database grows later must degrade, not crash a screen.
assert.deepEqual(sessionStatusOf('deloading'), { label: 'To Do', color: 'error' })
assert.deepEqual(sessionStatusOf(null), { label: 'To Do', color: 'error' })

assert.deepEqual(setProgress(0, 3), { done: 0, total: 3, label: '0/3', complete: false })
assert.deepEqual(setProgress(3, 3), { done: 3, total: 3, label: '3/3', complete: true })
// Logging an extra set is allowed by the schema; it must read as complete and
// must not report more than prescribed.
assert.deepEqual(setProgress(5, 3), { done: 5, total: 3, label: '3/3', complete: true })
// A session exercise with no prescription must not produce '0/0' or NaN%.
assert.deepEqual(setProgress(0, 0), { done: 0, total: 0, label: '0/0', complete: false })

assert.deepEqual(
  planProgress([{ status: 'completed' }, { status: 'in_progress' }, { status: 'todo' }]),
  { completed: 1, total: 3, percent: 33 },
)
assert.deepEqual(planProgress([{ status: 'completed' }]), { completed: 1, total: 1, percent: 100 })
// Empty plan: percent must be 0, never NaN -- MUI renders NaN as an empty bar.
assert.deepEqual(planProgress([]), { completed: 0, total: 0, percent: 0 })
// Nearly-complete must not read as complete: round() would report 100 here.
assert.equal(planProgress(Array.from({ length: 200 }, (_, i) => ({
  status: i < 199 ? 'completed' : 'todo',
}))).percent, 99)

// `partial` is its own state: the member chose to stop early, which is neither
// "not done" nor "done as prescribed", and the card says which.
assert.deepEqual(sessionStatusOf('partial'), { label: 'Stopped Early', color: 'warning' })

// A partial counts towards the plan bar.  Counting only full completions would
// mean a member who ended one session early never sees the week reach 100%,
// which reads as an unfinished week rather than a finished-early one.
assert.deepEqual(
  planProgress([{ status: 'completed' }, { status: 'partial' }, { status: 'todo' }]),
  { completed: 2, total: 3, percent: 66 },
)
// A session being worked on right now is not yet done for the week.
assert.deepEqual(
  planProgress([{ status: 'in_progress' }, { status: 'todo' }]),
  { completed: 0, total: 2, percent: 0 },
)
// A week closed entirely with early finishes is still a closed week.
assert.deepEqual(
  planProgress([{ status: 'partial' }, { status: 'partial' }]),
  { completed: 2, total: 2, percent: 100 },
)

console.log('workout status: OK')
