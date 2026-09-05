import assert from 'node:assert/strict'
import { groupByMonth, monthLabel } from './grouping.js'

/** A row at a local wall-clock time, so the checks below do not depend on the
 *  machine's zone the way a fixed `Z` timestamp would. */
const at = (id, year, month, day, hour = 12) => ({
  id,
  title: `Reward ${id}`,
  points: 30,
  earned_at: new Date(year, month - 1, day, hour).toISOString(),
})

// --- monthLabel -------------------------------------------------------------
assert.equal(monthLabel('2026-09'), 'September 2026')
assert.equal(monthLabel('2026-01'), 'January 2026')

// --- grouping keeps the query's order and runs months together ---------------
const rows = [
  at('a', 2026, 9, 3),
  at('b', 2026, 9, 1),
  at('c', 2026, 8, 29),
  at('d', 2026, 8, 2),
  at('e', 2026, 7, 30),
]

const all = groupByMonth(rows, Infinity)
assert.deepEqual(all.groups.map((g) => g.label), ['September 2026', 'August 2026', 'July 2026'])
assert.deepEqual(all.groups.map((g) => g.items.length), [2, 2, 1])
assert.deepEqual(all.groups[0].items.map((r) => r.id), ['a', 'b'])
assert.equal(all.hidden, 0)
assert.equal(all.total, 5)

// --- the cap trims from the end, and reports what it hid --------------------
const capped = groupByMonth(rows, 3)
assert.equal(capped.shown, 3)
assert.equal(capped.hidden, 2)
assert.equal(capped.total, 5)
assert.deepEqual(capped.groups.map((g) => g.items.length), [2, 1])

// A cap landing exactly on the total must not claim anything is hidden, or the
// screen offers a "show all" button that reveals nothing.
const exact = groupByMonth(rows, 5)
assert.equal(exact.hidden, 0)

// --- degenerate input --------------------------------------------------------
assert.deepEqual(groupByMonth([], 10), { groups: [], shown: 0, total: 0, hidden: 0 })
assert.deepEqual(groupByMonth(undefined, 10), { groups: [], shown: 0, total: 0, hidden: 0 })
assert.deepEqual(groupByMonth(null), { groups: [], shown: 0, total: 0, hidden: 0 })

// A negative limit must not become a slice from the end, which would show the
// OLDEST rewards under a heading promising the newest.
assert.equal(groupByMonth(rows, -3).shown, 0)

// --- a row with no usable timestamp still renders, under its own heading -----
const undated = groupByMonth([{ id: 'x', earned_at: null }], 10)
assert.equal(undated.groups.length, 1)
assert.equal(undated.groups[0].label, 'Undated')

// --- the local-month trap ----------------------------------------------------
// Two instants 40 minutes apart that straddle local midnight on the 1st must
// land in different months, and the split must follow the *local* calendar.
const lateAug = new Date(2026, 7, 31, 23, 40)
const earlySep = new Date(2026, 8, 1, 0, 20)
const straddle = groupByMonth([
  { id: 's2', earned_at: earlySep.toISOString() },
  { id: 's1', earned_at: lateAug.toISOString() },
], Infinity)
assert.deepEqual(straddle.groups.map((g) => g.label), ['September 2026', 'August 2026'])

console.log('rewards grouping: OK')
