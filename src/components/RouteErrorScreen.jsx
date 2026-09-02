import { Button, Stack, Typography } from '@mui/material'
import { isRouteErrorResponse, useRouteError } from 'react-router'

export default function RouteErrorScreen() {
  const error = useRouteError()
  const message = isRouteErrorResponse(error)
    ? error.statusText
    : error?.message

  return (
    <Stack
      role="alert"
      spacing={2}
      sx={{ minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', p: 3, textAlign: 'center' }}
    >
      <Typography variant="h1">This screen could not be opened</Typography>
      <Typography color="text.secondary">
        {message || 'An unexpected error occurred. Your saved data has not been removed.'}
      </Typography>
      <Button variant="contained" onClick={() => window.location.reload()}>
        Reload app
      </Button>
    </Stack>
  )
}
