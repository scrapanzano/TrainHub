import { useCallback, useEffect, useState } from 'react'
import { elapsedMs, isPaused, pauseTimer, resumeTimer, startTimer } from './timer.js'

const storageKey = (sessionId) => `trainhub-live-${sessionId}`

function readStored(sessionId) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(sessionId)))
  } catch {
    return null
  }
}

/**
 * A live session's clock, surviving a reload.
 *
 * The state is three timestamps, persisted on every change: a phone that locks,
 * a tab the browser evicts, or a member who reloads mid-workout must all come
 * back to the same running clock rather than to zero.
 */
export function useLiveSession(sessionId) {
  const [state, setState] = useState(() => readStored(sessionId))
  const [now, setNow] = useState(() => Date.now())

  // React Router reuses this component between two matches of the same route,
  // so the initialiser above runs only for whichever session mounted first.
  // Correcting during render rather than in an effect is deliberate: on the
  // render where `sessionId` changes, the persist effect below fires in the same
  // commit and would otherwise write the previous session's clock under the new
  // session's key.  This is React's documented "adjust state when a prop
  // changes" pattern -- state rather than a ref, because reading a ref during
  // render is forbidden.
  const [loadedFor, setLoadedFor] = useState(sessionId)
  if (loadedFor !== sessionId) {
    setLoadedFor(sessionId)
    setState(readStored(sessionId))
  }

  useEffect(() => {
    if (state) {
      localStorage.setItem(storageKey(sessionId), JSON.stringify(state))
    } else {
      localStorage.removeItem(storageKey(sessionId))
    }
  }, [sessionId, state])

  useEffect(() => {
    // The interval only forces a re-render; the elapsed value is derived from
    // timestamps, so a tick the browser skips while throttled costs nothing.
    if (!state || isPaused(state)) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [state])

  const start = useCallback(() => setState(startTimer(Date.now())), [])
  const pause = useCallback(() => setState((prev) => (prev ? pauseTimer(prev, Date.now()) : prev)), [])
  const resume = useCallback(
    () => setState((prev) => (prev ? resumeTimer(prev, Date.now()) : prev)),
    [],
  )
  const clear = useCallback(() => setState(null), [])

  return {
    started: state !== null,
    paused: state !== null && isPaused(state),
    elapsed: state ? elapsedMs(state, now) : 0,
    start,
    pause,
    resume,
    clear,
  }
}
