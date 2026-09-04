// Pure. No imports, so the self-check runs under bare Node.

/**
 * The local calendar month of an ISO instant, as `'YYYY-MM'`.
 *
 * Local, not UTC: a session finished at 00:30 on 1 September in Rome carries a
 * `2026-08-31T22:30:00Z` timestamp, and grouping on the raw string would file
 * it under August for a member who trained in September.  Same trap
 * `localDayISO` exists for in `src/lib/format.js`; duplicated here rather than
 * imported so this module stays dependency-free.
 */
function monthKeyOf(timestamp) {
  // `new Date(null)` is the epoch, not an invalid date, so a missing timestamp
  // would quietly file the row under January 1970 rather than admitting it has
  // no date.  The emptiness has to be caught before the constructor sees it.
  if (timestamp === null || timestamp === undefined || timestamp === '') return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** `'2026-09'` → `'September 2026'`, built from parts so it stays local. */
export function monthLabel(key) {
  const [year, month] = key.split('-').map(Number)
  return new Date(year, month - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

/**
 * The earned list, cut to a readable length and grouped by month.
 *
 * The screen used to render every row the query returned, unlimited and
 * undated, so a year of training became a few hundred identical cards reading
 * "Completed Upper Body A" with nothing to tell them apart -- while
 * `earned_at` was already being fetched and thrown away.
 *
 * Input order is trusted: the query returns newest first, and re-sorting here
 * would silently disagree with it if that ever changed.
 *
 * @param {Array}  rewards      Rows, newest first.
 * @param {number} [limit=10]   How many to keep. `Infinity` shows everything.
 * @returns {{groups: Array<{key: string, label: string, items: Array}>,
 *            shown: number, total: number, hidden: number}}
 */
export function groupByMonth(rewards, limit = 10) {
  const all = rewards ?? []
  const visible = limit === Infinity ? all : all.slice(0, Math.max(0, limit))

  const groups = []
  for (const reward of visible) {
    const key = monthKeyOf(reward.earned_at)
    const last = groups[groups.length - 1]
    // Rows arrive newest first, so every month is one contiguous run and a
    // running comparison is enough -- no map, and the order is the query's.
    if (last && last.key === key) last.items.push(reward)
    else groups.push({ key, label: key ? monthLabel(key) : 'Undated', items: [reward] })
  }

  return {
    groups,
    shown: visible.length,
    total: all.length,
    hidden: all.length - visible.length,
  }
}
