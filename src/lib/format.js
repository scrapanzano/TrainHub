// Date and time rendering, kept pure and free of imports so the self-check can
// run under bare Node with no bundler.

/** `'10:00 - 11:00'` from two ISO timestamps, in the viewer's local zone. */
export function formatTimeRange(startISO, endISO) {
  const opts = { hour: '2-digit', minute: '2-digit' }
  const start = new Date(startISO).toLocaleTimeString('en-GB', opts)
  const end = new Date(endISO).toLocaleTimeString('en-GB', opts)
  return `${start} - ${end}`
}

/**
 * `'21/04/2026'` from a Postgres `date` (`'2026-04-21'`).
 *
 * Parsed by hand rather than through `new Date()`: the Date constructor reads a
 * bare date string as UTC midnight, which renders as the previous day for every
 * viewer west of Greenwich.  A plan expiring on the 21st must not display as
 * the 20th.
 */
export function formatDate(dateISO) {
  if (!dateISO) return ''
  const [year, month, day] = String(dateISO).slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

/**
 * The local calendar day, as `'YYYY-MM-DD'`, of a full ISO instant (e.g. a
 * `timestamptz` from Supabase such as `'2026-07-15T23:30:00+00:00'`).
 *
 * `new Date(timestamp)` on a *full* timestamp is safe -- it parses the
 * embedded offset (or `Z`) and the `get*` calls below read it back in the
 * viewer's local zone. That is the opposite case from `formatDate` above,
 * where the input is a bare `'YYYY-MM-DD'` `date` with no time or offset at
 * all, so the constructor falls back to UTC midnight and shifts a day
 * backwards for anyone east of Greenwich. Full timestamp in → local
 * constructor is fine; bare date in → local constructor is the trap.
 */
export function localDayISO(timestamp) {
  const d = new Date(timestamp)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Today as `'YYYY-MM-DD'` in the local calendar, for day-scoped queries. */
export function todayISO() {
  return localDayISO(new Date())
}

/**
 * `'2026-07-29'` + `'14:00'` + 60 → two ISO timestamps in the local zone.
 *
 * Both booking sheets -- the member's and the professional's -- turn a native
 * `<input type="date">` plus `<input type="time">` into the `timestamptz` pair
 * an appointment needs, and both must read "14:00" as the *user's* two o'clock.
 * Built from local parts for that reason: `new Date('2026-07-29T14:00')` is
 * implementation-dependent and `new Date('2026-07-29')` is UTC midnight.
 */
export function slotToISO(dayISO, timeHHMM, minutes) {
  const [year, month, day] = dayISO.split('-').map(Number)
  const [hour, minute] = timeHHMM.split(':').map(Number)
  const start = new Date(year, month - 1, day, hour, minute, 0, 0)
  const end = new Date(start.getTime() + minutes * 60_000)
  return { startsAt: start.toISOString(), endsAt: end.toISOString() }
}
