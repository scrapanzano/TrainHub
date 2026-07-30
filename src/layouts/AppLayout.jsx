import { useQuery } from '@tanstack/react-query'
import { Box, Button, Stack, Typography } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router'
import BottomNav from '../components/BottomNav.jsx'
import OfflineBanner from '../components/OfflineBanner.jsx'
import { LoadingState } from '../components/ScreenState.jsx'
import TopHeader from '../components/TopHeader.jsx'
import { fetchUnreadCount } from '../data/chat.js'
import { useAuth } from '../features/auth/useAuth.js'
import { queryKeys } from '../lib/queryKeys.js'

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
    queryKey: queryKeys.unreadCount(user?.id),
    queryFn: () => fetchUnreadCount(user.id),
    // Nothing to count until somebody is signed in.
    enabled: Boolean(user?.id),
    // Polled rather than pushed: the chat's Realtime channel is filtered to one
    // `thread_id` and lives on the conversation screen, so it cannot feed a
    // badge that must count every thread. This layout never unmounts on inner
    // navigation either, so without an interval the badge freezes at its
    // page-load value. A shell-level subscription is the fuller answer and is
    // not worth a second channel at this scale.
    refetchInterval: 60_000,
  })

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
        <Stack role="alert" spacing={2} alignItems="center" sx={{ maxWidth: 320 }}>
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
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Header and sync status pin as one block.  The banner is meant to be a
          persistent indicator; left in normal flow it scrolls away and is only
          visible at the top of the page. */}
      <Box sx={{ position: 'sticky', top: 0, zIndex: 'appBar' }}>
        <TopHeader profileHref={profileHref} notificationCount={unread.data ?? 0} />
        <OfflineBanner />
      </Box>
      <Box component="main" sx={{ flexGrow: 1, pb: 2 }}>
        <Outlet />
      </Box>
      <BottomNav items={navItems} />
    </Box>
  )
}
