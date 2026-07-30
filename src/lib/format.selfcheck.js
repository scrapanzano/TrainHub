// Run with:  node src/lib/format.selfcheck.js
import assert from 'node:assert/strict'
import { formatDate, formatTimeRange, localDayISO, slotToISO, todayISO } from './format.js'

// Times render in the viewer's local zone, so the fixtures carry an explicit
// offset and the expectations are computed rather than hard-coded -- otherwise
// this file passes in Italy and fails in CI.
const start = '2026-04-21T08:00:00Z'
const end = '2026-04-21T09:00:00Z'
const local = (iso) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })

assert.equal(formatTimeRange(start, end), `${local(start)} - ${local(end)}`)

// A date-only string must not shift a day backwards for anyone east of UTC,
// which is exactly what `new Date('2026-04-21')` then `.getDate()` would do.
assert.equal(formatDate('2026-04-21'), '21/04/2026')
assert.equal(formatDate(null), '')
assert.equal(formatDate(undefined), '')

// todayISO must agree with the local calendar, not with UTC.
const now = new Date()
const expected = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, '0'),
  String(now.getDate()).padStart(2, '0'),
].join('-')
assert.equal(todayISO(), expected)

// localDayISO must read back the viewer's *local* calendar day from a full
// ISO instant (e.g. a `timestamptz`), not the naive `String(ts).slice(0, 10)`
// UTC slice it replaces. Each fixture is built by round-tripping through the
// local Date constructor: `new Date(y, m, d, h, min)` is read in local time,
// and `.toISOString()` renders that instant in UTC -- so the gap between the
// two is exactly the bug this covers.
//
// One case near local midnight from each side, so at least one differs from
// the naive UTC slice in any zone with a non-zero offset:
// - early morning local (01:30) lands on the *previous* UTC day in any
//   positive-offset zone (east of Greenwich, e.g. Europe/Rome) -- this is the
//   TrainHub failure case.
// - late evening local (23:30) lands on the *next* UTC day in any
//   negative-offset zone (west of Greenwich, e.g. US zones).
// On a machine running exactly UTC (offset 0) neither instant crosses a day
// boundary, so the naive slice and localDayISO agree there and no assertion
// in this file can tell them apart on that one machine.
const earlyMorningLocal = new Date(2026, 6, 16, 1, 30) // 16 July, 01:30 local
assert.equal(localDayISO(earlyMorningLocal.toISOString()), '2026-07-16')

const lateEveningLocal = new Date(2026, 6, 16, 23, 30) // 16 July, 23:30 local
assert.equal(localDayISO(lateEveningLocal.toISOString()), '2026-07-16')

// todayISO delegates to localDayISO; keep them provably in sync.
assert.equal(todayISO(), localDayISO(new Date()))

// slotToISO must read "14:00" as the *user's* two o'clock, whatever zone they
// are in, and must not fall into either date trap. Expectations are computed
// through the local Date constructor for the same reason as above: a hard-coded
// UTC string would pass only in Britain in winter.
const slot = slotToISO('2026-07-29', '14:00', 60)
assert.equal(slot.startsAt, new Date(2026, 6, 29, 14, 0).toISOString())
assert.equal(slot.endsAt, new Date(2026, 6, 29, 15, 0).toISOString())

// The local calendar day of the start must be the day that was asked for. This
// is the assertion that fails if anyone reaches for `new Date(dayISO)` -- UTC
// midnight plus 14 hours is still the 29th in Rome, but plus 00:30 is the 28th.
assert.equal(localDayISO(slotToISO('2026-07-29', '00:30', 30).startsAt), '2026-07-29')
assert.equal(localDayISO(slotToISO('2026-07-29', '23:30', 30).startsAt), '2026-07-29')

// A duration that crosses midnight local must land on the next day, not wrap.
assert.equal(localDayISO(slotToISO('2026-07-29', '23:30', 60).endsAt), '2026-07-30')

// Single-digit month and day must not be mis-parsed (`'2026-01-05'` → January
// the 5th, and January is month index 0, not 1).
assert.equal(slotToISO('2026-01-05', '09:00', 30).startsAt, new Date(2026, 0, 5, 9, 0).toISOString())

// 30 minutes is exactly 30 minutes, in milliseconds, not 30 of anything else.
const half = slotToISO('2026-07-29', '10:00', 30)
assert.equal(new Date(half.endsAt) - new Date(half.startsAt), 30 * 60_000)

console.log('format: OK')
