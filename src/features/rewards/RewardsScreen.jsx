import {
  Alert, Box, Card, CardContent, LinearProgress, List, ListItem, ListItemText, Stack, Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { fetchRewards } from '../../data/rewards.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { POINTS, rewardProgress } from '../workout/summary.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { isSubscriptionActive } from '../clients/subscription.js'
import { todayISO } from '../../lib/format.js'
import { useAuth } from '../auth/useAuth.js'
import PageHeader from '../../components/PageHeader.jsx'

// What the member can spend points on.  A catalogue, not user data, so it lives
// in the client until there is a reason for it to live in Postgres.
const CATALOGUE = [
  { code: 'shake', title: 'Free Protein Shake', points: 1000 },
  { code: 'session', title: 'Free PT Session', points: 2500 },
  { code: 'month', title: 'One Month Free', points: 6000 },
]

export default function RewardsScreen() {
  const { user, profile } = useAuth()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.rewards(user.id),
    queryFn: () => fetchRewards(user.id),
  })

  if (isPending) return <LoadingState />
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const total = data.reduce((sum, reward) => sum + reward.points, 0)
  const progress = rewardProgress(total, CATALOGUE)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader title="Rewards" backTo="/m/profile" backLabel="Back to profile" />

      {!isSubscriptionActive(profile, todayISO()) ? (
        <Alert severity="info">
          Your membership is not active — you are not earning points right now.
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          <Typography variant="h3">
            Points Earned
          </Typography>
          <Typography variant="h1" component="p">
            {progress.total.toLocaleString('en-GB')}{' '}
            <Typography component="span" variant="h3" color="text.secondary">
              pts
            </Typography>
          </Typography>

          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {progress.next === null
              ? 'Every reward unlocked.'
              : `+${progress.remaining} points to next reward`}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress.percent}
            aria-label={
              progress.next === null
                ? 'Every reward unlocked'
                : `${progress.remaining} points to the next reward`
            }
            sx={{ height: 8, borderRadius: 999, mt: 1 }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Rewards
          </Typography>
          <List disablePadding>
            {CATALOGUE.map((reward, index) => (
              <ListItem key={reward.code} disableGutters divider={index > 0}>
                  <ListItemText
                    primary={reward.title}
                    secondary={
                      total >= reward.points
                        ? `${reward.points} points • unlocked`
                        : `${reward.points} points`
                    }
                  />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Points System
          </Typography>
          <Stack spacing={0.5}>
            <Typography>
              <Box component="span" sx={{ color: 'primary.main', fontWeight: 700 }}>
                +{POINTS.workout} points
              </Box>{' '}
              maximum for one workout, weighted by the prescribed sets completed
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
            Show this screen at the reception to claim a reward
          </Typography>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Earned
        </Typography>
        {data.length === 0 ? (
          <EmptyState
            title="Nothing earned yet"
            description="Finish a workout to earn your first points."
          />
        ) : (
          <Stack spacing={1}>
            {data.map((reward) => (
              <Card key={reward.id}>
                <CardContent>
                  <Typography variant="h3">{reward.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    +{reward.points} points
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
