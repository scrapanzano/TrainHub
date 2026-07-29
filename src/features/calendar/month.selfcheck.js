// Run with:  node src/features/calendar/month.selfcheck.js
import assert from 'node:assert/strict'
import { monthGrid, monthLabel, shiftMonth, weekStrip, WEEKDAY_INITIALS } from './month.js'

// March 2026 starts on a Sunday, so a Monday-first grid opens with six padding
// days from February.  This is the case a Sunday-first implementation gets
// wrong while looking right for most other months.
const march = monthGrid(2026, 3)
assert.equal(march.length, 42, 'six whole weeks')
assert.deepEqual(march[0], { dateISO: '2026-02-23', day: 23, inMonth: false })
assert.deepEqual(march[6], { dateISO: '2026-03-01', day: 1, inMonth: true })
assert.deepEqual(march[7], { dateISO: '2026-03-02', day: 2, inMonth: true })
assert.deepEqual(march[36], { dateISO: '2026-03-31', day: 31, inMonth: true })
assert.deepEqual(march.at(-1), { dateISO: '2026-04-05', day: 5, inMonth: false })
assert.equal(march.filter((cell) => cell.inMonth).length, 31)

// A month that both starts on a Monday and ends on a Sunday needs no padding at
// all, and must not gain a blank trailing week.
const june = monthGrid(2026, 6)
assert.equal(june.length, 35)
assert.deepEqual(june[0], { dateISO: '2026-06-01', day: 1, inMonth: true })
assert.deepEqual(june.at(-1), { dateISO: '2026-07-05', day: 5, inMonth: false })

// February in a leap year, since the whole grid hangs off the day count.
const feb2028 = monthGrid(2028, 2)
assert.equal(feb2028.filter((cell) => cell.inMonth).length, 29)
assert.ok(feb2028.some((cell) => cell.dateISO === '2028-02-29'))

// Every grid is whole weeks and strictly consecutive, with no repeated or
// skipped day across a month boundary.
for (const grid of [march, june, feb2028]) {
  assert.equal(grid.length % 7, 0)
  for (let i = 1; i < grid.length; i += 1) {
    const previous = Date.parse(`${grid[i - 1].dateISO}T00:00:00Z`)
    const current = Date.parse(`${grid[i].dateISO}T00:00:00Z`)
    assert.equal(current - previous, 86_400_000, `gap before ${grid[i].dateISO}`)
  }
}

// The strip is the week CONTAINING the anchor, not the seven days after it.
const strip = weekStrip('2026-03-31')
assert.equal(strip.length, 7)
assert.deepEqual(
  strip.map((cell) => cell.dateISO),
  ['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05'],
)
assert.deepEqual(strip[0], { dateISO: '2026-03-30', day: 30, weekday: 'M' })
assert.deepEqual(strip[6], { dateISO: '2026-04-05', day: 5, weekday: 'S' })

// An anchor that is already a Monday must not shift back a week.
assert.equal(weekStrip('2026-03-30')[0].dateISO, '2026-03-30')
// Nor must a Sunday roll forward into the next one.
assert.equal(weekStrip('2026-04-05')[0].dateISO, '2026-03-30')

// Month stepping wraps the year in both directions.
assert.deepEqual(shiftMonth(2026, 3, 1), { year: 2026, month: 4 })
assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 })
assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 })
assert.deepEqual(shiftMonth(2026, 1, -13), { year: 2024, month: 12 })

assert.equal(monthLabel(2026, 3), 'March 2026')
assert.equal(monthLabel(2026, 12), 'December 2026')

assert.deepEqual(WEEKDAY_INITIALS, ['M', 'T', 'W', 'T', 'F', 'S', 'S'])

console.log('month.selfcheck OK')
