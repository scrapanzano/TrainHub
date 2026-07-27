import { Box, Typography } from '@mui/material'

/**
 * Stands in for a screen that has not been built yet.  Replaced one at a time
 * across phases 1-4; the route tree never changes.
 */
export default function Placeholder({ name }) {
  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h1">{name}</Typography>
      <Typography color="text.secondary">Not built yet.</Typography>
    </Box>
  )
}
