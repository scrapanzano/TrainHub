// Pure mapping from a profile's subscription columns to the pill the client
// roster and the client dossier both draw.  No imports, so the self-check runs
// under bare Node.

const ACTIVE    = { label: 'Active', color: 'success.main' }
const EXPIRING  = { label: 'Close to Expiring', color: 'warning.main' }
const EXPIRED   = { label: 'Expired', color: 'error.main' }
const SUSPENDED = { label: 'Suspended', color: 'task.suspended' }
const UNKNOWN   = { label: 'Unknown', color: 'task.suspended' }

/** Whole days from `fromISO` to `toISO`, both `'YYYY-MM-DD'`. */
function daysBetween(fromISO, toISO) {
  const [fy, fm, fd] = fromISO.slice(0, 10).split('-').map(Number)
  const [ty, tm, td] = toISO.slice(0, 10).split('-').map(Number)
  // UTC on both sides so the subtraction cannot straddle a DST boundary and come
  // back 23 or 25 hours, which then rounds to the wrong number of days.
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/**
 * The membership state to show, given the stored status and the renewal date.
 *
 * `subscription_status` is a column nothing sweeps: it still reads 'active' the
 * morning after `subscription_until` passes.  So an elapsed date outranks it,
 * and only 'suspended' and 'expired' -- states a human set deliberately --
 * outrank the date in turn.
 *
 * @param {?{subscription_status: string, subscription_until: ?string}} profile
 * @param {string} todayISO `'YYYY-MM-DD'` in the viewer's local calendar.
 */
export function subscriptionStateOf(profile, todayISO) {
  if (!profile) return UNKNOWN
  if (profile.subscription_status === 'suspended') return SUSPENDED
  if (profile.subscription_status === 'expired') return EXPIRED

  const until = profile.subscription_until
  // An open-ended membership is the gym's problem, not this component's.
  if (!until) return ACTIVE

  const remaining = daysBetween(todayISO, until)
  if (remaining < 0) return EXPIRED
  if (remaining <= 30) return EXPIRING
  return ACTIVE
}
