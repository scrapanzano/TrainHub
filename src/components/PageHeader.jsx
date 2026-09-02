import { IconButton, Stack, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { Link } from 'react-router'

/** Consistent title and explicit parent navigation for secondary screens. */
export default function PageHeader({ title, subtitle = null, backTo, backLabel }) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: 'flex-start', minWidth: 0, width: '100%', textAlign: 'left' }}
    >
      <IconButton
        component={Link}
        to={backTo}
        aria-label={backLabel}
        edge="start"
        sx={{ mt: -0.5, flexShrink: 0 }}
      >
        <ArrowBackIosNewIcon fontSize="small" />
      </IconButton>

      <Stack spacing={0.25} sx={{ minWidth: 0, pt: 0.25 }}>
        <Typography variant="h1">{title}</Typography>
        {subtitle ? (
          <Typography color="text.secondary">{subtitle}</Typography>
        ) : null}
      </Stack>
    </Stack>
  )
}
