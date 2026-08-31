import { Box, Button, CircularProgress, Stack, Typography } from '@mui/material'

const centred = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  p: 4,
  gap: 2,
  minHeight: 240,
}

export function LoadingState() {
  // role="status" so a screen reader announces the wait instead of silence.
  return (
    <Box sx={centred} role="status" aria-label="Loading">
      <CircularProgress />
    </Box>
  )
}

export function ErrorState({ error, onRetry }) {
  // Offline is the common case in this app, not an exception, so it gets its own
  // wording -- "something went wrong" would send a user hunting for a fault that
  // is really just a tunnel or a lift.
  const offline = !navigator.onLine

  return (
    <Box sx={centred} role="alert">
      <Typography variant="h3">{offline ? 'You are offline' : 'Something went wrong'}</Typography>
      <Typography color="text.secondary">
        {offline
          ? 'This screen needs data we have not cached yet. It will load once you are back online.'
          : (error?.message ?? 'Please try again.')}
      </Typography>
      {onRetry ? (
        <Button variant="contained" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Box>
  )
}

/**
 * Nothing here yet.
 *
 * `action` is optional and sits below the copy: an empty state that can offer
 * the way out of itself should, and one that cannot stays exactly as it was.
 */
export function EmptyState({
  title,
  description,
  action = null,
  minHeight = 240,
  padding = 4,
}) {
  return (
    <Box sx={{ ...centred, minHeight, p: padding }}>
      <Stack spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h3">{title}</Typography>
        {description ? <Typography color="text.secondary">{description}</Typography> : null}
      </Stack>
      {action}
    </Box>
  )
}
