import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, LinearProgress, List, ListItem, ListItemText,
  Stack, Typography,
} from '@mui/material'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'
import { useQuery } from '@tanstack/react-query'
import { fetchRewards } from '../../data/rewards.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { POINTS, rewardProgress } from '../workout/summary.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { isSubscriptionActive } from '../clients/subscription.js'
import { formatDate, localDayISO, todayISO } from '../../lib/format.js'
import { useAuth } from '../auth/useAuth.js'
import PageHeader from '../../components/PageHeader.jsx'
import { groupByMonth } from './grouping.js'

/** How many of the earned rewards are shown before the list is cut. */
const VISIBLE_LIMIT = 10

// What the member can spend points on.  A catalogue, not user data, so it lives
// in the client until there is a reason for it to live in Postgres.
const CATALOGUE = [
  { code: 'shake', title: 'Free Protein Shake', points: 1000 },
  { code: 'session', title: 'Free PT Session', points: 2500 },
  { code: 'month', title: 'One Month Free', points: 6000 },
]

export default function RewardsScreen() {
  const { user, profile } = useAuth()
  const [showAll, setShowAll] = useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.rewards(user.id),
    queryFn: () => fetchRewards(user.id),
  })

  if (isPending) return <LoadingState />
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const total = data.reduce((sum, reward) => sum + reward.points, 0)
  const progress = rewardProgress(total, CATALOGUE)
  const earned = groupByMonth(data, showAll ? Infinity : VISIBLE_LIMIT)
  // `rewardProgress` reports the next milestone as its point cost, not the
  // catalogue row, so the name has to be looked back up to be shown.
  const nextReward = CATALOGUE.find((reward) => reward.points === progress.next) ?? null

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

          <LinearProgress
            variant="determinate"
            value={progress.percent}
            aria-label={
              progress.next === null
                ? 'Every reward unlocked'
                : `${progress.remaining} points to ${nextReward?.title ?? 'the next reward'}`
            }
            sx={{ height: 8, borderRadius: 999, mt: 2 }}
          />
          {/* Naming the next reward: "+160 points to next reward" sent the
              member down to the catalogue to find out what they were working
              towards. `aria-hidden` because the bar above announces the same
              sentence already. */}
          <Typography color="text.secondary" sx={{ mt: 1 }} aria-hidden>
            {progress.next === null ? 'Every reward unlocked.' : (
              <>
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>
                  {progress.remaining} points
                </Box>
                {' to '}
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>
                  {nextReward?.title ?? 'the next reward'}
                </Box>
              </>
            )}
          </Typography>
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
        <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline', mb: 2 }}>
          <Typography variant="h2" sx={{ flexGrow: 1 }}>
            Earned
          </Typography>
          {earned.total > 0 ? (
            <Typography variant="body2" color="text.secondary">
              {earned.total} in total
            </Typography>
          ) : null}
        </Stack>

        {data.length === 0 ? (
          <EmptyState
            title="Nothing earned yet"
            description="Finish a workout to earn your first points."
          />
        ) : (
          <Stack spacing={2}>
            {earned.groups.map((group) => (
              <Box key={group.key}>
                <Typography variant="overline" color="text.secondary" component="h3">
                  {group.label}
                </Typography>
                <Stack spacing={1} sx={{ mt: 0.5 }}>
                  {group.items.map((reward) => (
                    <Card key={reward.id}>
                      <CardContent>
                        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                          <EmojiEventsIcon color="primary" />
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Typography variant="h3" noWrap>{reward.title}</Typography>
                            {/* The date was already fetched and dropped, which
                                left repeated session titles indistinguishable. */}
                            <Typography variant="body2" color="text.secondary">
                              {reward.earned_at ? formatDate(localDayISO(reward.earned_at)) : ''}
                            </Typography>
                          </Box>
                          <Typography sx={{ fontWeight: 700, color: 'primary.main' }}>
                            +{reward.points}
                          </Typography>
                        </Stack>
                      </CardContent>
                    </Card>
                  ))}
                </Stack>
              </Box>
            ))}

            {/* Unbounded before: a year of training rendered as several hundred
                stacked cards with no way to stop it. */}
            {earned.hidden > 0 ? (
              <Button variant="outlined" fullWidth onClick={() => setShowAll(true)}>
                Show all {earned.total}
              </Button>
            ) : null}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
