// The weekly frame the workout half turns on.  A session has no stored status:
// it is whatever its runs say inside the current ISO week.
//
// The only import is `format.js`, which is itself import-free, so the
// self-check still runs under bare Node with no bundler.
import { localDayISO } from './format.js'

/**
 * The Monday of `dayISO`'s ISO week, as `'YYYY-MM-DD'`.
 *
 * Accepts either a bare `'YYYY-MM-DD'` or a full ISO instant, and reads both in
 * the local calendar.  Built from local date parts rather than through
 * `new Date('YYYY-MM-DD')`, which is UTC midnight and lands on the previous day
 * west of Greenwich -- the difference between resetting the plan on Monday and
 * resetting it on Sunday evening for anyone in the Americas.
 *
 * `getDay()` calls Sunday 0, so it is remapped to 7 before subtracting.
 * Without that, Sunday would start the week about to begin rather than close
 * the one just finished, and every Sunday workout would land in the wrong week.
 */
/** A local `Date` back to `'YYYY-MM-DD'`, in the local calendar. */
function toDayISO(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

export function mondayOf(dayISO) {
  const [year, month, day] = String(dayISO).slice(0, 10).split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  date.setDate(date.getDate() - (weekday - 1))
  return toDayISO(date)
}

/**
 * `n` days before `dayISO`, in the local calendar.
 *
 * Exists so callers never reach for `Date.now() - n * 86_400_000`, which is
 * wrong across a daylight-saving boundary -- one day that year is 23 hours long
 * and another is 25 -- nor for `toISOString()`, which converts to UTC and
 * reintroduces the off-by-one-day this module exists to prevent.
 */
export function daysBefore(dayISO, n) {
  const [year, month, day] = String(dayISO).slice(0, 10).split('-').map(Number)
  return toDayISO(new Date(year, month - 1, day - n))
}

/**
 * What one session's runs say about it, for the week starting `weekStartISO`.
 *
 * Precedence, and why:
 *
 * 1. An OPEN run wins outright, whatever week it started in.  It is what the
 *    member is doing now, and one left open last week must stay visible: the
 *    partial unique index in `patches/013` blocks a second open run, so hiding
 *    it would strand the member with no way to start anything at all.
 * 2. Otherwise the most recently started run CLOSED INSIDE THIS WEEK decides,
 *    and its outcome is the status.
 * 3. `abandoned` is not a status.  It is the absence of one: the session is
 *    there to be done again, this week, from zero.
 *
 * Returns the deciding run alongside the status, because every caller that
 * wants one wants the other -- the id to resume, the day it was finished on,
 * the percentage it stopped at.
 */
export function runStatusOf(runs, weekStartISO) {
  const all = runs ?? []

  const open = all.find((run) => !run.ended_at)
  if (open) return { status: 'in_progress', run: open }

  const thisWeek = all
    .filter((run) => run.outcome === 'completed' || run.outcome === 'partial')
    // Compared on the LOCAL day, not on the raw ISO string: a session started
    // at 23:30 on Sunday carries a UTC timestamp dated Monday, and a string
    // comparison would file it under the week that had not begun yet.
    .filter((run) => localDayISO(run.started_at) >= weekStartISO)
    // Parsed rather than compared as text.  Postgres returns timestamptz
    // normalised to UTC so the two orders agree today, but a mixed-offset
    // string sorts by the characters and not by the instant.
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))

  if (thisWeek.length === 0) return { status: 'todo', run: null }
  return { status: thisWeek[0].outcome, run: thisWeek[0] }
}
