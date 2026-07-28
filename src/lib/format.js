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

/** Today as `'YYYY-MM-DD'` in the local calendar, for day-scoped queries. */
export function todayISO() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
