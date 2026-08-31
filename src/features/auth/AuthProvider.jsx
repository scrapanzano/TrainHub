import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { persister, queryClient } from '../../lib/queryClient.js'
import { PROFILE_UPDATED_EVENT } from '../../data/profile.js'
import { disablePush } from '../profile/pushSubscription.js'
import { AuthContext } from './AuthContext.js'

const PROFILE_COLUMNS =
  'id, role, specialty, full_name, avatar_url, assigned_pro_id, subscription_status, subscription_until'

// `forUserId` is the whole point of this shape: it records WHICH user the
// profile belongs to, so readiness can be recomputed from current state on
// every render instead of being stored in a flag.  A stored flag went stale --
// the profile effect ran on mount before `getSession()` had resolved, marked
// itself ready for a user nobody had looked up yet, and produced one committed
// render claiming the role was settled when it was not.
const NO_PROFILE = { forUserId: undefined, data: null, error: null }

// The role decides which shell renders, so a cold start with no network needs
// it before any query runs.  Row Level Security still governs every real read --
// this copy only picks a layout, it grants nothing.
const PROFILE_CACHE_KEY = 'trainhub-profile'

function readCachedProfile(userId) {
  try {
    const cached = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY))
    return cached?.id === userId ? cached : null
  } catch {
    // Unparseable or unavailable storage is not worth failing a sign-in over.
    return null
  }
}

function writeCachedProfile(profile) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
  } catch {
    // Quota exceeded or private mode.  The app still works, just not offline.
  }
}

// postgrest-js catches network failures itself and RESOLVES with an error whose
// `code` is empty, so the promise never rejects and a `.catch` cannot see this.
// An empty code, or a browser that already knows it is offline, is the signal.
const isOfflineError = (error) => error?.code === '' || !navigator.onLine

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [profileState, setProfileState] = useState(NO_PROFILE)

  useEffect(() => {
    let active = true

    // getSession resolves from local storage first, so a cold start offline
    // still knows who is signed in.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setSessionReady(true)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      // Supabase warns against awaiting its own client inside this callback:
      // doing so deadlocks the auth lock.  Only synchronous state here; the
      // profile fetch happens in the effect below.
      setSession(next)
      setSessionReady(true)
      if (event === 'SIGNED_OUT') {
        try {
          localStorage.removeItem(PROFILE_CACHE_KEY)
        } catch {
          // Storage cleanup is best effort; memory is cleared below regardless.
        }
        queryClient.clear()
        persister.removeClient().catch(() => {})
        setProfileState(NO_PROFILE)
        // Run outside Supabase's auth callback lock. This removes the browser
        // subscription even when another tab initiated the sign-out.
        setTimeout(() => disablePush().catch(() => {}), 0)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null

  useEffect(() => {
    const acceptProfileUpdate = (event) => {
      const profile = event.detail
      if (!profile || profile.id !== userId) return
      writeCachedProfile(profile)
      setProfileState({ forUserId: userId, data: profile, error: null })
    }

    window.addEventListener(PROFILE_UPDATED_EVENT, acceptProfileUpdate)
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, acceptProfileUpdate)
  }, [userId])

  useEffect(() => {
    // Until the session is known, this effect has nothing to say.  Returning
    // early keeps it from recording a result for a user it has not looked up.
    if (!sessionReady || !userId) return

    let active = true

    // postgrest retries a failed GET three times with 1s/2s/4s backoff, which is
    // the right call for a transient 503 and the wrong one for a phone in a gym
    // basement: it turns "offline" into seven seconds of nothing. Retry only when
    // the browser thinks there is a network, so the transient-error handling is
    // kept and the offline path fails immediately.
    supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .single()
      .retry(navigator.onLine)
      .then(({ data, error }) => {
        if (!active) return

        if (!error) {
          writeCachedProfile(data)
          setProfileState({ forUserId: userId, data, error: null })
          return
        }

        // Offline with a cached profile is not a failure -- it is the case this
        // app exists to handle.  Fall back to the cache and let the shell render;
        // only a denial, or an offline start that was never online, is an error.
        const offline = isOfflineError(error)
        const cached = offline ? readCachedProfile(userId) : null

        setProfileState({
          forUserId: userId,
          data: cached,
          error: cached ? null : { ...error, offline },
        })
      })
      .catch((cause) => {
        // Reached only if something outside postgrest throws.  Kept as a floor
        // so an unexpected rejection cannot leave `loading` true forever.
        if (!active) return
        const cached = readCachedProfile(userId)
        setProfileState({
          forUserId: userId,
          data: cached,
          error: cached
            ? null
            : { offline: true, message: 'Could not reach the server.', cause },
        })
      })

    return () => {
      active = false
    }
  }, [sessionReady, userId])

  const signOut = useCallback(async () => {
    // Whoever signs in next on this device must not keep receiving the previous
    // user's notifications. Best effort: a failure here must not prevent the
    // sign-out itself, which is the same reasoning that already clears the
    // profile mirror before the network call.
    try {
      await disablePush()
    } catch {
      // Ignored on purpose.
    }

    // Drop the cached profile first: if the network call fails, the local
    // session is still cleared and the stale copy must not outlive it.
    try {
      localStorage.removeItem(PROFILE_CACHE_KEY)
    } catch {
      // Nothing to do -- signing out matters more than tidying storage.
    }

    // Same reasoning applies to the query cache, and matters more: it holds
    // this user's chat messages, nutrition plan, body metrics, appointments
    // and session logs. AppLayout navigates on sign-out without a page
    // reload, so nothing else would ever tear down the in-memory QueryClient
    // or its IndexedDB mirror -- they would sit there in cleartext, readable
    // via DevTools, for up to a week, on a device the next person may also
    // use. `clear()` empties memory now; `removeClient()` deletes the
    // IndexedDB entry directly instead of leaving it for the throttled
    // persist subscription to notice and overwrite a moment later. This also
    // discards any paused mutations still queued for this user -- on a
    // deliberate sign-out that is the correct trade, not a bug to fix back.
    queryClient.clear()
    try {
      await persister.removeClient()
    } catch {
      // Best-effort: the in-memory cache is already cleared either way.
    }

    await supabase.auth.signOut()
  }, [])

  const value = useMemo(() => {
    // Only trust the profile if it belongs to the user currently signed in.
    // Otherwise the outgoing account's data would show for a render after a
    // switch or a sign-out.
    const matches = profileState.forUserId === userId

    return {
      session,
      user: session?.user ?? null,
      profile: matches ? profileState.data : null,
      profileError: matches ? profileState.error : null,
      // `loading` answers one question: do we know enough to route yet?  It is
      // false once the session is known and, when someone is signed in, once
      // their profile has either arrived or definitively failed.
      loading: !sessionReady || (Boolean(session) && !matches),
      signOut,
    }
  }, [session, sessionReady, profileState, userId, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
