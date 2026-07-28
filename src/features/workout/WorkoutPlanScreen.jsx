import {
  Box, Card, CardContent, Divider, Fab, LinearProgress, Stack, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatDate } from '../../lib/format.js'
import { planProgress } from './status.js'
import SessionCard from '../../components/SessionCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function WorkoutPlanScreen() {
  const { user } = useAuth()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  if (isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds a good plan, and an error
  // screen instead of that plan is the wrong answer for an offline gym.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />
  if (!data) {
    return (
      <EmptyState
        title="No plan yet"
        description="Once your trainer assigns a workout plan, it will appear here."
      />
    )
  }

  const { plan, sessions } = data
  const progress = planProgress(sessions)
  const subtitle = [plan.goal, plan.level].filter(Boolean).join(' - ')

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography variant="h1">Workout Plan</Typography>
        <Fab
          component={Link}
          to="/m/workout/builder"
          color="primary"
          size="small"
          aria-label="Add a session"
        >
          <AddIcon />
        </Fab>
      </Stack>

      <Card>
        <CardContent>
          <Typography variant="h2" component="h3">{plan.name}</Typography>
          {subtitle ? (
            <Typography color="primary" sx={{ mb: 2 }}>
              {subtitle}
            </Typography>
          ) : null}

          {/* Two columns on any phone wide enough, stacked below that -- the
              labels are short but "Duration: 6 weeks" still wraps badly at 320px. */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              rowGap: 0.5,
              columnGap: 2,
            }}
          >
            <Typography variant="body2">Sessions: {sessions.length}</Typography>
            <Typography variant="body2">Duration: {plan.weeks} weeks</Typography>
            {plan.author ? (
              <Typography variant="body2">Created by: {plan.author.full_name}</Typography>
            ) : null}
          </Box>

          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={progress.percent}
              aria-label={`${progress.completed} of ${progress.total} sessions completed`}
              sx={{ height: 8, borderRadius: 999 }}
            />
            <Typography variant="body2" color="text.secondary" aria-hidden sx={{ mt: 0.5 }}>
              {progress.completed} of {progress.total} sessions completed
            </Typography>
          </Box>

          {plan.expires_on ? (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                Expiration: {formatDate(plan.expires_on)}
              </Typography>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Sessions
        </Typography>

        {sessions.length === 0 ? (
          <EmptyState
            title="This plan has no sessions"
            description="Your trainer is still putting it together."
          />
        ) : (
          <Stack spacing={2}>
            {sessions.map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                to={`/m/workout/session/${session.id}`}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
