// Pure aggregation for the professional's progress screen.  No imports, so the
// self-check runs under bare Node.

const pad = (n) => String(n).padStart(2, '0')

/** The local calendar day a timestamp falls on, as `'YYYY-MM-DD'`. */
function localDayOf(timestamp) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function localDateOf(dayISO) {
  const [year, month, day] = dayISO.slice(0, 10).split('-').map(Number)
  return new Date(year, month - 1, day)
}

function dateISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Coach-facing snapshot of the current workout week. */
export function workoutWeekSummary(runs, totalSessions, todayISO) {
  const today = localDateOf(todayISO)
  const daysSinceMonday = (today.getDay() + 6) % 7
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday)
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
  const weekStart = dateISO(monday)
  const ordered = [...(runs ?? [])].sort((a, b) =>
    String(b.started_at).localeCompare(String(a.started_at)))
  const latestBySession = new Map()

  for (const run of ordered) {
    const dayISO = localDayOf(run.started_at)
    if (dayISO < weekStart || dayISO > todayISO) continue
    if (run.outcome !== 'completed' && run.outcome !== 'partial') continue
    if (!latestBySession.has(run.session_id)) latestBySession.set(run.session_id, run)
  }

  const currentRuns = [...latestBySession.values()]
  const completed = currentRuns.filter((run) => run.outcome === 'completed').length
  const partial = currentRuns.filter((run) => run.outcome === 'partial').length
  // A weekly target is fulfilled only by a completed prescription. Partial
  // attempts remain visible to the coach, but cannot fill a progress bar
  // labelled "completed" or make the remaining-session count drop to zero.
  const done = completed
  const safeTotal = Math.max(0, Number(totalSessions) || 0)

  return {
    weekStart,
    weekEnd: dateISO(sunday),
    completed,
    partial,
    todo: Math.max(0, safeTotal - completed - partial),
    done,
    total: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.min(100, Math.round((completed / safeTotal) * 100)),
    sessionIds: currentRuns.map((run) => run.session_id),
    completedSessionIds: currentRuns
      .filter((run) => run.outcome === 'completed')
      .map((run) => run.session_id),
    lastRun: ordered.find((run) => run.ended_at) ?? null,
    openRun: ordered.find((run) => run.ended_at === null || run.ended_at === undefined) ?? null,
  }
}

/** Active workout time, excluding pauses. Open runs intentionally return null. */
export function runDurationMs(run) {
  if (!run?.started_at || !run?.ended_at) return null
  const wallClock = new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()
  return Math.max(0, wallClock - Math.max(0, Number(run.paused_total_ms) || 0))
}

/**
 * How many different prescribed sessions the client closed this ISO week.
 *
 * Only completed runs fill the weekly target; partial and abandoned runs do
 * not. Repeating the same session twice still fills one weekly target slot,
 * matching the member's plan screen rather than counting calendar days or
 * individual sets.
 *
 * @param {Array<{session_id: string, started_at: string, outcome: string}>} runs
 * @param {number} totalSessions Sessions in the plan: the weekly target.
 * @param {string} todayISO `'YYYY-MM-DD'`, the local calendar today.
 */
export function weeklyTraining(runs, totalSessions, todayISO) {
  const summary = workoutWeekSummary(runs, totalSessions, todayISO)

  return {
    done: summary.done,
    total: summary.total,
    // Kept as `days` for the screen's existing dot renderer. Only the length is
    // used there; cap it so a repeated/legacy plan cannot overflow the row.
    days: summary.completedSessionIds.slice(0, summary.total),
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
