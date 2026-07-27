import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase.js'
import { AuthContext } from './AuthContext.js'

const PROFILE_COLUMNS =
  'id, role, specialty, full_name, avatar_url, assigned_pro_id, subscription_status'

// `forUserId` is the whole point of this shape: it records WHICH user the
// profile belongs to, so readiness can be recomputed from current state on
// every render instead of being stored in a flag.  A stored flag went stale --
// the profile effect ran on mount before `getSession()` had resolved, marked
// itself ready for a user nobody had looked up yet, and produced one committed
// render claiming the role was settled when it was not.
const NO_PROFILE = { forUserId: undefined, data: null, error: null }

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
    } = supabase.auth.onAuthStateChange((_event, next) => {
      // Supabase warns against awaiting its own client inside this callback:
      // doing so deadlocks the auth lock.  Only synchronous state here; the
      // profile fetch happens in the effect below.
      setSession(next)
      setSessionReady(true)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null

  useEffect(() => {
    // Until the session is known, this effect has nothing to say.  Returning
    // early keeps it from recording a result for a user it has not looked up.
    if (!sessionReady) return

    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfileState({ forUserId: null, data: null, error: null })
      return
    }

    let active = true

    supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', userId)
      .single()
      .then(({ data, error }) => {
        if (!active) return
        // A signed-in user with no readable profile row is a real state, not an
        // impossible one: the row may be missing, or RLS may deny it.  Recording
        // it as a resolved-with-error result beats leaving the profile null
        // forever with nothing able to tell "still loading" from "never coming".
        setProfileState({ forUserId: userId, data: error ? null : data, error: error ?? null })
      })
      .catch((cause) => {
        // Offline is the expected path here, not an exceptional one -- this is a
        // PWA and the network is optional.  Tagged so consumers can tell a dead
        // network from a server that answered "denied": a Postgrest error has a
        // `code`, this does not.
        if (!active) return
        setProfileState({
          forUserId: userId,
          data: null,
          error: { offline: true, message: 'Could not reach the server.', cause },
        })
      })

    return () => {
      active = false
    }
  }, [sessionReady, userId])

  const signOut = useCallback(async () => {
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
