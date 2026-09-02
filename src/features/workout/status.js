// Pure mappings shared by the workout screens.  No imports, so the self-check
// runs under bare Node.

// Frozen: sessionStatusOf() returns these same objects to every caller.
// A mutation in one place would corrupt the lookup table for the entire app.
const TODO = Object.freeze({ label: 'To Do', color: 'error' })

/** Session status → the label and palette key the wireframes use. */
const SESSION_STATUS = Object.freeze({
  todo: TODO,
  in_progress: Object.freeze({ label: 'In Progress', color: 'warning' }),
  completed: Object.freeze({ label: 'Completed', color: 'success' }),
  // Stopping early is a decision, not a failure, and not the same thing as
  // finishing.  It earns weighted points and the card says so.
  partial: Object.freeze({ label: 'Stopped Early', color: 'warning' }),
})

/**
 * Total-safe lookup.  The enum can gain values in the database before the UI
 * knows about them, and a screen that throws on an unrecognised status is worse
 * than one that shows a conservative default.
 */
export function sessionStatusOf(status) {
  return SESSION_STATUS[status] ?? TODO
}

/**
 * Progress for one exercise, as the `0/3` pill in the wireframes.
 *
 * `done` is the raw count and `label` is clamped: nothing stops a member from
 * logging a fourth set, but `4/3` reads like a bug to everyone who sees it.
 */
export function setProgress(loggedCount, targetSets) {
  const done = loggedCount ?? 0
  const total = targetSets ?? 0
  return {
    done,
    total,
    label: `${Math.min(done, total)}/${total}`,
    complete: total > 0 && done >= total,
  }
}

/** Plan-level roll-up. `percent` stays an integer so it can key an aria-label. */
export function planProgress(sessions) {
  const total = sessions.length
  // The bar says "completed", so only a session whose whole prescription was
  // met may fill it. A partial run remains visible on its card and is counted
  // separately; calling one exercise out of three a completed session made the
  // plan say 1/4 when the member had plainly not finished that session.
  const completed = sessions.filter((session) => session.status === 'completed').length
  const partial = sessions.filter((session) => session.status === 'partial').length
  // Guard the divide: an empty plan is a real state (a member with no plan yet)
  // and 0/0 would put NaN into a progress bar.
  // Floor, not round: 199 of 200 sessions rounds to 100 and shows a full bar
  // for a plan that is not finished.  A bar may understate progress; it must
  // never claim work that has not been done.
  const percent = total === 0 ? 0 : Math.floor((completed / total) * 100)
  return { completed, partial, total, percent }
}
