// Run with:  node src/lib/week.selfcheck.js
import assert from 'node:assert/strict'
import { daysBefore, mondayOf, runStatusOf } from './week.js'

// --- mondayOf -------------------------------------------------------------
// 2026-08-05 is a Wednesday; its week starts Monday the 3rd.
assert.equal(mondayOf('2026-08-05'), '2026-08-03')
// A Monday is its own week start, not the one before.
assert.equal(mondayOf('2026-08-03'), '2026-08-03')
// Sunday belongs to the week that began six days earlier -- the ISO rule, and
// the reason getDay() cannot be used raw: it calls Sunday 0.
assert.equal(mondayOf('2026-08-09'), '2026-08-03')
// Across a month boundary.
assert.equal(mondayOf('2026-09-01'), '2026-08-31')
// Across a year boundary.
assert.equal(mondayOf('2027-01-01'), '2026-12-28')
// A full ISO instant is accepted too, so callers need not slice it themselves.
assert.equal(mondayOf('2026-08-05T22:30:00+02:00'), '2026-08-03')

// --- daysBefore -----------------------------------------------------------
assert.equal(daysBefore('2026-08-10', 7), '2026-08-03')
assert.equal(daysBefore('2026-08-03', 0), '2026-08-03')
// Back across a month boundary.
assert.equal(daysBefore('2026-09-02', 7), '2026-08-26')
// Back across a year boundary.
assert.equal(daysBefore('2027-01-04', 7), '2026-12-28')
// Across the European DST change (Sunday 2026-03-29, when one day is 23 hours).
// Subtracting milliseconds would land on the 22nd at 23:00 and render as the
// 22nd or the 23rd depending on the hour; calendar arithmetic cannot.
assert.equal(daysBefore('2026-03-30', 7), '2026-03-23')
// And across the autumn change (Sunday 2026-10-25, a 25-hour day).
assert.equal(daysBefore('2026-10-26', 7), '2026-10-19')

// --- runStatusOf ----------------------------------------------------------
const WEEK = '2026-08-03'
const open = { id: 'r1', started_at: '2026-08-05T10:00:00+02:00', ended_at: null, outcome: null }
const done = { id: 'r2', started_at: '2026-08-04T10:00:00+02:00', ended_at: '2026-08-04T11:00:00+02:00', outcome: 'completed' }
const part = { id: 'r3', started_at: '2026-08-04T10:00:00+02:00', ended_at: '2026-08-04T10:30:00+02:00', outcome: 'partial' }
const quit = { id: 'r4', started_at: '2026-08-04T10:00:00+02:00', ended_at: '2026-08-04T10:05:00+02:00', outcome: 'abandoned' }
const lastWeek = { id: 'r5', started_at: '2026-07-29T10:00:00+02:00', ended_at: '2026-07-29T11:00:00+02:00', outcome: 'completed' }

assert.deepEqual(runStatusOf([], WEEK), { status: 'todo', run: null })
// A session that has never been touched has no runs array at all.
assert.deepEqual(runStatusOf(undefined, WEEK), { status: 'todo', run: null })
assert.deepEqual(runStatusOf([done], WEEK), { status: 'completed', run: done })
assert.deepEqual(runStatusOf([part], WEEK), { status: 'partial', run: part })

// An open run wins over anything else: it is what the member is doing NOW.
assert.deepEqual(runStatusOf([done, open], WEEK), { status: 'in_progress', run: open })
assert.deepEqual(runStatusOf([open], WEEK), { status: 'in_progress', run: open })

// Abandoned does not count -- the session is there to be done again.
assert.deepEqual(runStatusOf([quit], WEEK), { status: 'todo', run: null })
// ...but a completed run alongside an abandoned one still counts.
assert.deepEqual(runStatusOf([quit, done], WEEK), { status: 'completed', run: done })

// Last week's completion does not carry into this week. This is the whole point:
// without it the plan reads as finished forever after one pass.
assert.deepEqual(runStatusOf([lastWeek], WEEK), { status: 'todo', run: null })

// Two closed runs in one week: the most recent decides, whatever order they
// arrive in.
const early = { id: 'r6', started_at: '2026-08-03T09:00:00+02:00', ended_at: '2026-08-03T09:20:00+02:00', outcome: 'partial' }
assert.deepEqual(runStatusOf([done, early], WEEK), { status: 'completed', run: done })
assert.deepEqual(runStatusOf([early, done], WEEK), { status: 'completed', run: done })

// An open run from a PREVIOUS week is still open -- the member never closed it.
// It must not be dropped: the partial unique index in patches/013 blocks a
// second open run, so hiding this one strands the member with no way to start
// anything at all.
const staleOpen = { id: 'r7', started_at: '2026-07-28T10:00:00+02:00', ended_at: null, outcome: null }
assert.deepEqual(runStatusOf([staleOpen], WEEK), { status: 'in_progress', run: staleOpen })

// A run started late on Sunday local time carries a UTC timestamp that falls on
// the following Monday. It belongs to the week it was STARTED in locally, so
// the comparison must be made on the local day, not on the raw ISO string.
const sundayNight = {
  id: 'r8',
  started_at: '2026-08-09T23:30:00+02:00', // Sunday 23:30 local = Monday 21:30 UTC
  ended_at: '2026-08-10T00:10:00+02:00',
  outcome: 'completed',
}
assert.deepEqual(runStatusOf([sundayNight], WEEK), { status: 'completed', run: sundayNight })
// ...and it does NOT leak into the following week.
assert.deepEqual(runStatusOf([sundayNight], '2026-08-10'), { status: 'todo', run: null })

console.log('workout week: OK')
