import { useEffect, useState } from 'react'
import { Alert, Box, Snackbar, Typography } from '@mui/material'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import { useMutationState } from '@tanstack/react-query'

const plural = (n) => (n === 1 ? '' : 's')

export default function OfflineBanner() {
  // `navigator.onLine` is a starting value, not a subscription -- the events are
  // what actually tell us, so both are needed.
  const [online, setOnline] = useState(() => navigator.onLine)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  // Only PAUSED mutations count as "waiting to sync".  Filtering on `pending`
  // alone would also catch every ordinary in-flight write and flash the banner
  // for a few hundred milliseconds on each one.
  const waiting = useMutationState({
    filters: { status: 'pending' },
    select: (mutation) => mutation.state.isPaused,
  }).filter(Boolean).length

  // A write that genuinely failed -- not one merely waiting for a network.
  // `LogSetSheet` rolls its optimistic count back on error, so without this the
  // set simply vanishes and the member believes it was recorded.
  const failed = useMutationState({
    filters: { status: 'error' },
    select: (mutation) => mutation.mutationId,
  }).length

  const banner =
    !online || waiting > 0 ? (
      <Box
        role="status"
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          py: 0.75,
          px: 2,
          bgcolor: 'task.suspended',
          color: 'text.primary',
        }}
      >
        <CloudOffIcon fontSize="small" aria-hidden />
        <Typography variant="body2">
          {online
            ? `Syncing ${waiting} change${plural(waiting)}…`
            : waiting > 0
              ? `Offline — ${waiting} change${plural(waiting)} will sync when you reconnect`
              : 'Offline — your workout still works'}
        </Typography>
      </Box>
    ) : null

  return (
    <>
      {banner}
      <Snackbar
        open={failed > 0 && !dismissed}
        onClose={() => setDismissed(true)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        // No auto-hide: a lost set is worth an explicit dismissal.
        sx={{ bottom: { xs: 72 } }}
      >
        <Alert severity="error" onClose={() => setDismissed(true)}>
          {failed} change{plural(failed)} could not be saved. Try again.
        </Alert>
      </Snackbar>
    </>
  )
}
