// Pure mapping from a profile's subscription columns to the pill the client
// roster and the client dossier both draw.  No imports, so the self-check runs
// under bare Node.

// Frozen: subscriptionStateOf() returns these same objects to every caller.
// A mutation in one place would corrupt the lookup table for the entire app.
const ACTIVE    = Object.freeze({ label: 'Active', color: 'success.main' })
const EXPIRING  = Object.freeze({ label: 'Close to Expiring', color: 'warning.main' })
const EXPIRED   = Object.freeze({ label: 'Expired', color: 'error.main' })
const SUSPENDED = Object.freeze({ label: 'Suspended', color: 'task.suspended' })
const UNKNOWN   = Object.freeze({ label: 'Unknown', color: 'task.suspended' })

/** Whole days from `fromISO` to `toISO`, both `'YYYY-MM-DD'` (or longer ISO
 * timestamps -- only the leading date part is read). */
export function daysBetween(fromISO, toISO) {
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

/**
 * Whether the member may currently use paid features -- the JS twin of the SQL
 * `has_active_subscription(member)` from patches/023. Same rule as
 * `subscriptionStateOf`: `suspended` and `expired` always fail, and an elapsed
 * `subscription_until` fails even while the status column still says 'active'.
 *
 * Pre-emptive UI only (the shell banner, disabled CTAs). The RPCs are the real
 * boundary.
 */
export function isSubscriptionActive(profile, todayISO) {
  if (!profile) return false
  if (profile.subscription_status === 'suspended') return false
  if (profile.subscription_status === 'expired') return false
  const until = profile.subscription_until
  if (!until) return true
  return daysBetween(todayISO, until) >= 0
}

/**
 * The professional's one context-aware membership button, given a
 * `subscriptionStateOf` result. `null` hides the button (Unknown state -- the
 * client row has not loaded, or has no status we can act on).
 */
export function membershipAction(state) {
  if (state.label === 'Suspended' || state.label === 'Expired') {
    return { label: 'Reactivate membership', nextStatus: 'active' }
  }
  if (state.label === 'Active' || state.label === 'Close to Expiring') {
    return { label: 'Suspend membership', nextStatus: 'suspended' }
  }
  return null
}
