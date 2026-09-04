// Pure. No imports, so the self-check runs under bare Node.

/**
 * The local calendar day of an ISO instant, as `'YYYY-MM-DD'`.
 *
 * Local, not the raw string: a message sent at 00:30 in Rome carries a
 * `…T22:30:00Z` timestamp from the day before, and slicing the string would
 * file it under yesterday for the person who just sent it. Duplicated from
 * `localDayISO` in `format.js` rather than imported, so this module has no
 * dependencies and its check runs bare.
 */
function dayOf(timestamp) {
  if (timestamp === null || timestamp === undefined || timestamp === '') return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Yesterday's `'YYYY-MM-DD'`, in the local calendar. */
function yesterdayOf(todayISO) {
  const [year, month, day] = todayISO.split('-').map(Number)
  // Built from parts and stepped by a day number: `new Date('2026-03-01')` is
  // UTC midnight, and subtracting 24h across a DST boundary lands at 23:00 of
  // the same day rather than the day before.
  const date = new Date(year, month - 1, day - 1)
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${m}-${d}`
}

/**
 * What a day separator says: `'Today'`, `'Yesterday'`, or the date itself.
 *
 * The weekday is part of it because these labels sit above a conversation or a
 * notification list, where "was that a Monday?" is the question being asked.
 */
export function dayLabel(dayISO, todayISO) {
  if (!dayISO) return 'Undated'
  if (dayISO === todayISO) return 'Today'
  if (dayISO === yesterdayOf(todayISO)) return 'Yesterday'

  const [year, month, day] = dayISO.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  const sameYear = year === Number(todayISO.slice(0, 4))
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    // The year only when it is not the obvious one; on a chat from this week it
    // is noise in every separator.
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/**
 * Split a list into contiguous runs of the same local day.
 *
 * The caller's order is preserved and never re-sorted: chat reads oldest
 * first, notifications newest first, and both are already ordered by the query
 * that fetched them. A run-length pass respects whichever it is; grouping into
 * a map and reading the keys back would not.
 *
 * @param {Array}    items
 * @param {Function} timestampOf  Pulls the instant out of one item.
 * @param {string}   todayISO     The viewer's today, for the labels.
 * @returns {Array<{key: string, label: string, items: Array}>}
 */
export function groupByDay(items, timestampOf, todayISO) {
  const groups = []
  for (const item of items ?? []) {
    const key = dayOf(timestampOf(item))
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(item)
    else groups.push({ key, label: dayLabel(key, todayISO), items: [item] })
  }
  return groups
}
