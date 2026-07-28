// Pure mappings shared by the workout screens.  No imports, so the self-check
// runs under bare Node.

const TODO = { label: 'To Do', color: 'error' }

/** Session status → the label and palette key the wireframes use. */
const SESSION_STATUS = {
  todo: TODO,
  in_progress: { label: 'In Progress', color: 'warning' },
  completed: { label: 'Completed', color: 'success' },
}

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
  const completed = sessions.filter((s) => s.status === 'completed').length
  // Guard the divide: an empty plan is a real state (a member with no plan yet)
  // and 0/0 would put NaN into a progress bar.
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100)
  return { completed, total, percent }
}
