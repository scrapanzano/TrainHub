import { Avatar, Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { Link } from 'react-router'
import { subscriptionStateOf } from '../features/clients/subscription.js'
import { todayISO } from '../lib/format.js'

export default function ClientCard({ client, to }) {
  const state = subscriptionStateOf(client, todayISO())

  return (
    <Card>
      <CardActionArea component={Link} to={to}>
        <CardContent>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar src={client.avatar_url ?? undefined} sx={{ width: 48, height: 48 }}>
              {client.full_name?.[0] ?? '?'}
            </Avatar>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h3" noWrap>
                {client.full_name}
              </Typography>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                {/* The dot carries the state by hue alone, so the label sits
                    beside it and the dot itself is hidden from the reader. */}
                <Box
                  aria-hidden
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: state.color }}
                />
                <Typography variant="body2" color="text.secondary" noWrap>
                  {/* A client with no plan yet has no goal to print, and
                      "null • Active" is worse than just the state. */}
                  {[client.goal, state.label].filter(Boolean).join(' • ')}
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
