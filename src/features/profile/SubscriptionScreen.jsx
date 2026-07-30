import { Card, CardContent, Chip, Divider, Stack, Typography } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { formatDate, todayISO } from '../../lib/format.js'
import { subscriptionStateOf } from '../clients/subscription.js'
import { useAuth } from '../auth/useAuth.js'

// What the gym includes. Static copy: there is no products table and inventing
// one for a fixed list would be a schema nobody writes to.
const INCLUDED = ['Gym Access', 'Locker Rooms', 'Sauna and Wellness Area']

export default function SubscriptionScreen() {
  const { profile } = useAuth()
  const state = subscriptionStateOf(profile, todayISO())

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Subscription</Typography>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="h3" sx={{ flexGrow: 1 }}>
                Annual Membership
              </Typography>
              <Chip
                size="small"
                label={state.label}
                sx={{ bgcolor: state.color, color: 'common.white' }}
              />
            </Stack>

            <Divider />

            <Stack direction="row" spacing={2}>
              <Typography color="text.secondary" sx={{ flexGrow: 1 }}>
                Valid until
              </Typography>
              <Typography>
                {profile?.subscription_until ? formatDate(profile.subscription_until) : '—'}
              </Typography>
            </Stack>

            <Stack direction="row" spacing={2}>
              <Typography color="text.secondary" sx={{ flexGrow: 1 }}>
                Membership ID
              </Typography>
              {/* The wireframe shows "#274982". There is no membership-number
                  column, and inventing one would be a fiction the database
                  cannot back, so this is the real row id, shortened. */}
              <Typography>#{String(profile?.id ?? '').slice(0, 8)}</Typography>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1.5 }}>
            Included Inside Membership
          </Typography>
          <Stack spacing={1}>
            {INCLUDED.map((item) => (
              <Stack key={item} direction="row" spacing={1.5} alignItems="center">
                <CheckIcon color="success" fontSize="small" />
                <Typography color="text.secondary">{item}</Typography>
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}
