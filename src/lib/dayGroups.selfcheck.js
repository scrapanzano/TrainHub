import assert from 'node:assert/strict'
import { dayLabel, groupByDay } from './dayGroups.js'

/** An instant at a local wall-clock time, so nothing here depends on the zone
 *  the check happens to run in. */
const at = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).toISOString()

// --- dayLabel ---------------------------------------------------------------
assert.equal(dayLabel('2026-09-04', '2026-09-04'), 'Today')
assert.equal(dayLabel('2026-09-03', '2026-09-04'), 'Yesterday')
assert.equal(dayLabel('', '2026-09-04'), 'Undated')

// Yesterday across a month boundary, which a naive `day - 1` on the string
// would render as "2026-09-00".
assert.equal(dayLabel('2026-08-31', '2026-09-01'), 'Yesterday')
// And across a year boundary.
assert.equal(dayLabel('2025-12-31', '2026-01-01'), 'Yesterday')
// And into a leap day, which only exists in the right years.
assert.equal(dayLabel('2028-02-29', '2028-03-01'), 'Yesterday')

// Anything older is dated. Same year: no year in the label.
const thisYear = dayLabel('2026-09-01', '2026-09-04')
assert.ok(!thisYear.includes('2026'), thisYear)
assert.ok(thisYear.includes('Sep'), thisYear)
// A different year says so, or the reader cannot place it at all.
const otherYear = dayLabel('2025-09-01', '2026-09-04')
assert.ok(otherYear.includes('2025'), otherYear)

// --- groupByDay -------------------------------------------------------------
const stamp = (t) => t.sent

// Oldest first, the way a conversation reads.
const chat = [
  { id: 1, sent: at(2026, 9, 3, 18, 40) },
  { id: 2, sent: at(2026, 9, 4, 9, 12) },
  { id: 3, sent: at(2026, 9, 4, 9, 14) },
]
const chatGroups = groupByDay(chat, stamp, '2026-09-04')
assert.deepEqual(chatGroups.map((g) => g.label), ['Yesterday', 'Today'])
assert.deepEqual(chatGroups.map((g) => g.items.length), [1, 2])
assert.deepEqual(chatGroups[1].items.map((m) => m.id), [2, 3])

// Newest first, the way a notification list reads. The caller's order must
// survive: re-sorting here would silently disagree with the query.
const inbox = [
  { id: 'a', sent: at(2026, 9, 4, 9, 12) },
  { id: 'b', sent: at(2026, 9, 3, 17, 40) },
  { id: 'c', sent: at(2026, 9, 3, 11, 2) },
]
const inboxGroups = groupByDay(inbox, stamp, '2026-09-04')
assert.deepEqual(inboxGroups.map((g) => g.label), ['Today', 'Yesterday'])
assert.deepEqual(inboxGroups[1].items.map((n) => n.id), ['b', 'c'])

// A day that comes back later is a separate run, not merged with the earlier
// one -- merging would move a message out of its place in the conversation.
const outOfOrder = groupByDay(
  [
    { id: 1, sent: at(2026, 9, 3) },
    { id: 2, sent: at(2026, 9, 4) },
    { id: 3, sent: at(2026, 9, 3) },
  ],
  stamp,
  '2026-09-04',
)
assert.equal(outOfOrder.length, 3)

// --- degenerate input --------------------------------------------------------
assert.deepEqual(groupByDay([], stamp, '2026-09-04'), [])
assert.deepEqual(groupByDay(undefined, stamp, '2026-09-04'), [])
assert.deepEqual(groupByDay(null, stamp, '2026-09-04'), [])

// `new Date(null)` is the epoch rather than an invalid date, so a missing
// timestamp has to be caught before the constructor sees it or the row is
// filed under January 1970.
const undated = groupByDay([{ id: 1, sent: null }], stamp, '2026-09-04')
assert.equal(undated.length, 1)
assert.equal(undated[0].label, 'Undated')

// --- the local-midnight trap -------------------------------------------------
// Two instants 40 minutes apart that straddle local midnight belong to
// different days, and the split follows the local calendar rather than UTC.
const straddle = groupByDay(
  [
    { id: 1, sent: at(2026, 9, 3, 23, 40) },
    { id: 2, sent: at(2026, 9, 4, 0, 20) },
  ],
  stamp,
  '2026-09-04',
)
assert.deepEqual(straddle.map((g) => g.label), ['Yesterday', 'Today'])

console.log('dayGroups: OK')
