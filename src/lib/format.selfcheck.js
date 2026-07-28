// Run with:  node src/lib/format.selfcheck.js
import assert from 'node:assert/strict'
import { formatDate, formatTimeRange, todayISO } from './format.js'

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

console.log('format: OK')
