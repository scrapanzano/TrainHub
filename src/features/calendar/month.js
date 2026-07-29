// Monday-first calendar arithmetic for the professional's calendar.  No
// imports, so the self-check runs under bare Node.
//
// Everything below computes in UTC and formats by hand.  `new Date('2026-03-01')`
// is UTC midnight, which renders as 28 February for every viewer west of
// Greenwich -- the same trap `formatDate` documents in src/lib/format.js.  A
// calendar is the one screen where that bug is unmissable.

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const DAY_MS = 86_400_000

/**
 * Column headers, matching the Monday-first order of `monthGrid`.
 *
 * Three of the seven repeat a letter, so a cell must never rely on these alone
 * to say which day it is -- every grid cell carries an `aria-label` with the
 * full date instead.
 */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const pad = (n) => String(n).padStart(2, '0')

/** `'YYYY-MM-DD'` from a UTC timestamp. */
function isoOf(utcMs) {
  const date = new Date(utcMs)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function parseISO(dateISO) {
  const [year, month, day] = dateISO.slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

/** Monday = 0 … Sunday = 6.  `getUTCDay` puts Sunday at 0, which is not the grid. */
function mondayIndex(utcMs) {
  return (new Date(utcMs).getUTCDay() + 6) % 7
}

/**
 * Every cell of a month's grid, padded to whole weeks with the neighbouring
 * months' days so the grid is rectangular.
 *
 * @param {number} year
 * @param {number} month 1-12, not the 0-based one `Date` uses.
 */
export function monthGrid(year, month) {
  const first = Date.UTC(year, month - 1, 1)
  const lead = mondayIndex(first)
  const start = first - lead * DAY_MS

  // Day 0 of the next month is the last day of this one -- the only
  // leap-year-safe way to ask how long February is.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  // Whole weeks only, and no blank trailing row when the month ends on a Sunday.
  const weeks = Math.ceil((lead + daysInMonth) / 7)

  return Array.from({ length: weeks * 7 }, (_unused, index) => {
    const utcMs = start + index * DAY_MS
    const date = new Date(utcMs)
    return {
      dateISO: isoOf(utcMs),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month - 1 && date.getUTCFullYear() === year,
    }
  })
}

/** The seven days of the week CONTAINING `anchorISO`, Monday first. */
export function weekStrip(anchorISO) {
  const anchor = parseISO(anchorISO)
  const monday = anchor - mondayIndex(anchor) * DAY_MS

  return Array.from({ length: 7 }, (_unused, index) => {
    const utcMs = monday + index * DAY_MS
    return {
      dateISO: isoOf(utcMs),
      day: new Date(utcMs).getUTCDate(),
      weekday: WEEKDAY_INITIALS[index],
    }
  })
}

/** Step a year/month pair, wrapping the year in either direction. */
export function shiftMonth(year, month, delta) {
  // Absolute months, so a delta larger than twelve wraps in one step instead of
  // needing a loop, and a negative one floors the year correctly.
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

/** `'March 2026'`. */
export function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`
}
