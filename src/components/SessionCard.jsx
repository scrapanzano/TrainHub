import { Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { Link } from 'react-router'
import { sessionStatusOf } from '../features/workout/status.js'

export default function SessionCard({ session, to }) {
  const { label, color } = sessionStatusOf(session.status)

  return (
    <Card>
      <CardActionArea component={Link} to={to}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="baseline">
                <Typography variant="h3" noWrap>
                  {session.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  • {session.exerciseCount} exercises
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                {/* A coloured dot alone would carry the status by hue only, so the
                    label sits next to it and the dot is hidden from the reader. */}
                <Box
                  aria-hidden
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: `${color}.main` }}
                />
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </Stack>
            </Box>

            <ChevronRightIcon color="primary" />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
