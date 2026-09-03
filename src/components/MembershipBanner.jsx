import { Box, Typography } from '@mui/material'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined'
import { useAuth } from '../features/auth/useAuth.js'
import { subscriptionStateOf } from '../features/clients/subscription.js'
import { todayISO } from '../lib/format.js'

// Copy per state. `Close to Expiring` is deliberately NOT here -- that stays a
// display-only pill, unchanged by this feature.
const MESSAGE = {
  Suspended:
    'Membership suspended — gym access, booking and rewards are paused. Contact your trainer.',
  Expired:
    'Membership expired — gym access, booking and rewards are paused. Contact your trainer.',
}

/**
 * A persistent bar in the member shell whenever their own subscription is not
 * active. Mounted next to OfflineBanner and styled to match it. Renders null
 * for professionals and for any active/expiring/unknown member.
 */
export default function MembershipBanner() {
  const { profile } = useAuth()
  if (profile?.role !== 'member') return null

  const message = MESSAGE[subscriptionStateOf(profile, todayISO()).label]
  if (!message) return null

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        py: 0.75,
        px: 2,
        bgcolor: 'error.main',
        color: 'error.contrastText',
      }}
    >
      <ErrorOutlineIcon fontSize="small" aria-hidden />
      <Typography variant="body2">{message}</Typography>
    </Box>
  )
}
