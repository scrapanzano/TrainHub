import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { elapsedMs, isPaused, resumeTimer } from './timer.js'

/**
 * A live session's clock, read from the run rather than from this device.
 *
 * It used to live in `localStorage` under a key made from the session id, which
 * had two consequences.  React Router reuses this component between two matches
 * of the same route, so moving from one live session to another carried the
 * first one's clock into the second -- the defect found on device.  And the
 * clock existed only in that browser: clearing site data, or picking the phone
 * back up as a different install, lost a workout in progress.
 *
 * The run row answers both.  `timer.js` is unchanged -- its three keys are
 * three columns -- so all that moves is where the state is read from.
 *
 * @param {?object} run      The open run, or null.
 * @param {string}  memberId Whose cache to update optimistically.
 */
export function useLiveSession(run, memberId) {
  const queryClient = useQueryClient()
  const [now, setNow] = useState(() => Date.now())

  const pauseRun = useMutation({ mutationKey: mutationKeys.pauseRun })
  const resumeRun = useMutation({ mutationKey: mutationKeys.resumeRun })

  const state = run
    ? {
        startedAt: Date.parse(run.started_at),
        pausedAt: run.paused_at ? Date.parse(run.paused_at) : null,
        pausedTotal: run.paused_total_ms ?? 0,
      }
    : null

  const paused = state !== null && isPaused(state)
  // Primitives, not the derived object: `state` is rebuilt on every render and
  // an effect depending on it would tear down and restart the interval each
  // second forever.
  const runId = run?.id ?? null

  useEffect(() => {
    // The interval only forces a re-render; the elapsed value is derived from
    // timestamps, so a tick the browser skips while throttled costs nothing and
    // the clock is still right when the phone comes back.
    if (!runId || paused) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runId, paused])

  // Offline these mutations pause and settle minutes later, so the cache is
  // written here rather than waiting for `onSettled`.  Without it, pressing
  // pause in a basement does nothing visible and the member presses it again.
  const patchRun = useCallback(
    (changes) => {
      queryClient.setQueryData(queryKeys.openRun(memberId), (current) =>
        current ? { ...current, ...changes } : current,
      )
    },
    [queryClient, memberId],
  )

  const pause = useCallback(() => {
    // Already paused is a no-op, not a second pause: pausing twice would move
    // `paused_at` forward and quietly hand the member back the minutes they
    // had already stopped for.
    if (!run || run.paused_at) return
    const pausedAt = new Date().toISOString()
    patchRun({ paused_at: pausedAt })
    pauseRun.mutate({ id: run.id, pausedAt })
  }, [run, patchRun, pauseRun])

  const resume = useCallback(() => {
    if (!run || !run.paused_at) return
    // `resumeTimer` credits the paused stretch and clamps a backwards clock
    // correction -- a negative total would be subtracted from every later
    // reading and inflate the clock permanently rather than once.
    const next = resumeTimer(
      {
        startedAt: Date.parse(run.started_at),
        pausedAt: Date.parse(run.paused_at),
        pausedTotal: run.paused_total_ms ?? 0,
      },
      Date.now(),
    )
    patchRun({ paused_at: null, paused_total_ms: next.pausedTotal })
    resumeRun.mutate({ id: run.id, pausedTotalMs: next.pausedTotal })
  }, [run, patchRun, resumeRun])

  return {
    started: state !== null,
    paused,
    elapsed: state ? elapsedMs(state, now) : 0,
    pause,
    resume,
  }
}
