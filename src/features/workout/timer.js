// Elapsed time as arithmetic over timestamps, not an accumulating counter.
// A counter driven by setInterval drifts, and stops entirely when the phone
// locks or the browser throttles a background tab -- which is precisely what
// happens during a set.  Storing when things happened and subtracting is
// immune to all of it.  No imports, so the self-check runs under bare Node.

/** A fresh, running timer. */
export function startTimer(now) {
  return { startedAt: now, pausedAt: null, pausedTotal: 0 }
}

export function isPaused(state) {
  return state.pausedAt !== null
}

/** Freeze the clock. Already paused is a no-op, not a second pause. */
export function pauseTimer(state, now) {
  if (isPaused(state)) return state
  return { ...state, pausedAt: now }
}

/** Resume, crediting the paused stretch to `pausedTotal` rather than losing it. */
export function resumeTimer(state, now) {
  if (!isPaused(state)) return state
  return {
    ...state,
    pausedAt: null,
    pausedTotal: state.pausedTotal + (now - state.pausedAt),
  }
}

/**
 * Wall-clock time since the start, minus everything spent paused.
 *
 * Clamped at zero: a device whose clock is corrected backwards mid-session
 * would otherwise render a negative duration, and "-00:00:04" in the middle of
 * a workout looks like the app has broken.
 */
export function elapsedMs(state, now) {
  const upTo = isPaused(state) ? state.pausedAt : now
  return Math.max(0, upTo - state.startedAt - state.pausedTotal)
}

/** `'00:07:20'`. Hours are not wrapped -- a forgotten session reads 25:00:00. */
export function formatElapsed(ms) {
  const total = Math.floor(ms / 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return [pad(Math.floor(total / 3600)), pad(Math.floor(total / 60) % 60), pad(total % 60)].join(':')
}
