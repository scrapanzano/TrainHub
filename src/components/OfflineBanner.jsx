import { useEffect, useState } from 'react'
import { Alert, Box, Snackbar, Typography } from '@mui/material'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import { useMutationState } from '@tanstack/react-query'

const plural = (n) => (n === 1 ? '' : 's')

export default function OfflineBanner() {
  // `navigator.onLine` is a starting value, not a subscription -- the events are
  // what actually tell us, so both are needed.
  const [online, setOnline] = useState(() => navigator.onLine)

  // Which failures the member has already acknowledged.  A single boolean would
  // latch: dismissing one failure would silence every later one, and a lost set
  // with no warning is exactly what this snackbar exists to prevent.
  const [dismissed, setDismissed] = useState(() => new Set())

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

  // A write that genuinely failed -- not one merely waiting for a network, and
  // not one still retrying, which stays `pending` until its retries run out.
  // The exercise screen's log panel rolls its optimistic row back on error, so
  // without this the set simply vanishes and the member believes it was
  // recorded.
  const failedIds = useMutationState({
    filters: { status: 'error' },
    select: (mutation) => mutation.mutationId,
  })

  const unacknowledged = failedIds.filter((id) => !dismissed.has(id))

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
              : 'Offline — your changes are saved and will sync when you reconnect'}
        </Typography>
      </Box>
    ) : null

  return (
    <>
      {banner}
      <Snackbar
        open={unacknowledged.length > 0}
        onClose={() => setDismissed(new Set(failedIds))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        // No auto-hide: a lost set is worth an explicit dismissal.
        sx={{
          // Clear the bottom navigation, including the iOS home indicator the
          // bar pads itself with.  A flat pixel guess sits behind the nav on any
          // device with a safe-area inset.
          bottom: 'calc(56px + env(safe-area-inset-bottom) + 8px)',
        }}
      >
        <Alert severity="error" onClose={() => setDismissed(new Set(failedIds))}>
          {unacknowledged.length} change{plural(unacknowledged.length)} could not be saved. Try
          again.
        </Alert>
      </Snackbar>
    </>
  )
}
