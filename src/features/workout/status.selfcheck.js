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

console.log('workout status: OK')
