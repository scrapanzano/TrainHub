// Pure aggregation for the professional's progress screen.  No imports, so the
// self-check runs under bare Node.

const pad = (n) => String(n).padStart(2, '0')

/** The local calendar day a timestamp falls on, as `'YYYY-MM-DD'`. */
function localDayOf(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * How many days in the last week the client actually trained.
 *
 * Counted as DISTINCT days carrying at least one logged set, not as a count of
 * logs: a client who does eight sets on Monday trained once, and a per-log
 * count would show a perfect week for one session.
 *
 * `workout_sessions` has no date column, so nothing else in the schema can
 * answer "did they train on Tuesday" -- the set logs are the only evidence.
 *
 * @param {Array<{performed_at: string}>} logs
 * @param {number} totalSessions Sessions in the plan: the weekly target.
 * @param {string} todayISO `'YYYY-MM-DD'`, the local calendar today.
 */
export function weeklyTraining(logs, totalSessions, todayISO) {
  const [year, month, day] = todayISO.slice(0, 10).split('-').map(Number)
  // Inclusive seven-day window: today and the six days before it.  Compared as
  // strings, which is safe because ISO dates sort lexicographically.
  const cutoff = new Date(year, month - 1, day - 6)
  const cutoffISO = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`

  const days = [
    ...new Set(
      (logs ?? [])
        .map((log) => localDayOf(log.performed_at))
        .filter((dayISO) => dayISO >= cutoffISO && dayISO <= todayISO),
    ),
  ].sort()

  return {
    done: days.length,
    total: totalSessions,
    // The screen draws one dot per planned session, so hand back at most that
    // many.  `done` stays truthful; only the ring is clamped.
    days: days.slice(0, totalSessions),
  }
}

/**
 * The client's latest weight and how it moved since the reading before it.
 *
 * @param {Array<{measured_on: string, weight_kg: ?number}>} metrics Newest first.
 */
export function weightTrend(metrics) {
  // A check-in can be a note with no measurement, so skip the rows that carry
  // no weight rather than reading a null as zero kilos.
  const weighed = (metrics ?? []).filter((metric) => metric.weight_kg !== null && metric.weight_kg !== undefined)

  if (weighed.length === 0) {
    return { current: null, deltaKg: null, direction: null, measuredOn: null }
  }

  const current = Number(weighed[0].weight_kg)
  const measuredOn = weighed[0].measured_on

  // One reading is a weight, not a trend.  Reporting 0 would claim the client
  // held steady when nobody has measured them twice.
  if (weighed.length === 1) {
    return { current, deltaKg: null, direction: null, measuredOn }
  }

  const previous = Number(weighed[1].weight_kg)
  // One decimal: scales read to 100 g, and binary floating point otherwise
  // turns 78.5 - 78.4 into 0.09999999999999432 on the screen.
  const deltaKg = Math.round((current - previous) * 10) / 10

  return {
    current,
    deltaKg,
    direction: deltaKg === 0 ? 'flat' : deltaKg < 0 ? 'down' : 'up',
    measuredOn,
  }
}
