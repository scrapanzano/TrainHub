import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router'
import BottomNav from '../components/BottomNav.jsx'
import LiveSessionBar from '../components/LiveSessionBar.jsx'
import OfflineBanner from '../components/OfflineBanner.jsx'
import { LoadingState } from '../components/ScreenState.jsx'
import TopHeader from '../components/TopHeader.jsx'
import { supabase } from '../lib/supabase.js'
import { fetchUnreadNotificationCount } from '../data/notifications.js'
import { fetchOpenRun } from '../data/runs.js'
import { elapsedMs } from '../features/workout/timer.js'
import { useAuth } from '../features/auth/useAuth.js'
import { queryKeys, queryPrefixes } from '../lib/queryKeys.js'

/**
 * The signed-in shell for both roles.  The only difference between a member's
 * app and a professional's is `navItems`, so one layout serves both.
 *
 * @param {object}  props
 * @param {Array}   props.navItems     Bottom-bar entries for this role.
 * @param {string}  props.profileHref  Where the avatar links.
 * @param {string}  props.requiredRole Role this section is reserved for.
 */
export default function AppLayout({ navItems, profileHref, requiredRole }) {
  const { user, profile, profileError, loading, signOut } = useAuth()
  const location = useLocation()

  const unread = useQuery({
    queryKey: queryKeys.unreadNotificationCount(user?.id),
    queryFn: () => fetchUnreadNotificationCount(user.id),
    // Nothing to count until somebody is signed in.
    enabled: Boolean(user?.id),
    // Polled rather than pushed: nothing in this shell subscribes to
    // Realtime for every notification-generating table, so a badge that
    // must reflect messages, appointments and plans together needs a poll
    // to notice a change made elsewhere. Same interval the chat inbox
    // already polls at.
    refetchInterval: 60_000,
  })

  const queryClient = useQueryClient()

  // The poll above is the fallback; this is what makes the badge update
  // without waiting up to 60s (or a full app reopen). Same pattern as
  // `useThreadMessages.js`'s chat channel: the query stays the source of
  // truth, Realtime only triggers a refetch. If the subscription never
  // fires, the poll still keeps the badge eventually correct.
  useEffect(() => {
    if (!user?.id) return

    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id, queryClient])

  // The member's open workout, if any.  Members only: a professional has no
  // workout of their own to be in the middle of.
  const openRun = useQuery({
    queryKey: queryKeys.openRun(user?.id),
    queryFn: () => fetchOpenRun(user.id),
    enabled: Boolean(user?.id) && requiredRole === 'member',
  })

  const run = openRun.data ?? null
  const showLiveBar = Boolean(run) && !location.pathname.endsWith('/live')
  const runId = run?.id ?? null
  const runPaused = Boolean(run?.paused_at)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    // Only forces a re-render; the elapsed value is arithmetic over timestamps,
    // so a tick the browser skips while throttled costs nothing.  Nothing ticks
    // when there is no workout open, which is almost always.  Keyed on
    // primitives, not on `run`: a fresh object each render would tear down and
    // restart the interval every second.
    if (!runId || runPaused) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runId, runPaused])

  // Hold the shell until the session is known, otherwise a signed-in user is
  // briefly bounced to /login on every cold start.  A spinner rather than null:
  // this gap is imperceptible online but real on a cold offline start, and a
  // white screen reads as a crash.
  if (loading) return <LoadingState />
  // Carry where they were headed, so signing in resumes the journey instead of
  // dumping everyone on the home screen.  `replace` keeps the bounced-from URL
  // out of history: Back should leave the app, not re-trigger this redirect.
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />

  // `loading === false` with a user means the profile has either arrived or
  // definitively failed — there is no "still in flight" state left to wait
  // out. A null profile here is a real failure, not a pending one, so it
  // must not fall through to rendering the shell (empty header, bottom bar
  // over a screen the user may not be entitled to). Distinguish a dead
  // network (retryable) from a denied/missing row (not retryable).
  if (!profile) {
    const offline = profileError?.offline === true
    return (
      <Box
        sx={{
          minHeight: '100dvh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 3,
        }}
      >
        {/* This swaps in without a navigation, so nothing would otherwise tell
            a screen reader the screen changed. */}
        <Stack role="alert" spacing={2} sx={{ alignItems: 'center', maxWidth: 320 }}>
          <Typography variant="h3">
            {offline ? 'You are offline' : 'Profile unavailable'}
          </Typography>
          <Typography color="text.secondary">
            {offline
              ? 'Could not reach the server to load your profile. Check your connection and try again.'
              : 'We could not load your account. Signing out and back in may fix it.'}
          </Typography>
          {offline ? (
            <Button variant="contained" onClick={() => window.location.reload()}>
              Retry
            </Button>
          ) : (
            // Without this the user is stuck: every route lands back here, and
            // the only other way out is clearing site data.
            <Button variant="contained" onClick={signOut}>
              Sign out
            </Button>
          )}
        </Stack>
      </Box>
    )
  }

  if (profile.role !== requiredRole) {
    return <Navigate to={profile.role === 'professional' ? '/p' : '/m'} replace />
  }

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        '--trainhub-bottom-shell-height': showLiveBar ? '120px' : '56px',
      }}
    >
      {/* Header and sync status pin as one block.  The banner is meant to be a
          persistent indicator; left in normal flow it scrolls away and is only
          visible at the top of the page. */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 'appBar' }}>
        <TopHeader
          profileHref={profileHref}
          notificationCount={unread.data ?? 0}
          notificationHref={requiredRole === 'professional' ? '/p/notifications' : '/m/notifications'}
          scanHref={requiredRole === 'professional' ? '/p/scan' : undefined}
        />
        <OfflineBanner />
      </Box>
      <Box component="main" sx={{ flexGrow: 1, pb: 2 }}>
        <Outlet />
      </Box>
      {/* The mini-player and the nav pin as one block, mirroring the header and
          the sync banner at the top.  `BottomNav` is sticky on its own, so a
          bar merely placed before it in the column scrolls out of sight on any
          screen taller than the viewport -- which is most of them, and exactly
          when a member has wandered away from their workout. */}
      <Box sx={{ position: 'sticky', bottom: 0, zIndex: 'appBar' }}>
        {showLiveBar ? (
          <LiveSessionBar
            sessionName={run.session?.name ?? 'Workout'}
            sessionId={run.session_id}
            paused={runPaused}
            elapsed={elapsedMs(
              {
                startedAt: Date.parse(run.started_at),
                pausedAt: run.paused_at ? Date.parse(run.paused_at) : null,
                pausedTotal: run.paused_total_ms ?? 0,
              },
              now,
            )}
          />
        ) : null}
        <BottomNav items={navItems} />
      </Box>
    </Box>
  )
}
