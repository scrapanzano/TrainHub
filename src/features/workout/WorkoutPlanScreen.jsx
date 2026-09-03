import { useEffect, useRef } from 'react'
import {
  Box, Button, Card, CardContent, Divider, LinearProgress, Stack, Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { runStatusOf } from '../../lib/week.js'
import { planProgress } from './status.js'
import SessionCard from '../../components/SessionCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/**
 * The fork a member with no plan is offered.
 *
 * Shown only here, in the empty state. A permanent banner above an active plan
 * would be noise over the thing the member came to see. `create_workout_plan_
 * secure` (patches/017) authorizes both the assigned professional and the
 * member themselves, so both paths are offered.
 */
function NoPlan({ hasCoach }) {
  return (
    <EmptyState
      title="No plan yet"
      description={
        hasCoach
          ? 'Your coach can write one for you after a consultation — or you can build your own.'
          : 'A coach can write one around your goals — or you can build your own.'
      }
      action={
        <Stack spacing={1} sx={{ width: '100%', maxWidth: 320 }}>
          <Button
            component={Link}
            to={hasCoach ? '/m/trainer' : '/m/trainer/browse'}
            variant="contained"
            size="large"
            fullWidth
          >
            {hasCoach ? 'Book a consultation' : 'Choose a coach'}
          </Button>
          <Button component={Link} to="/m/workout/builder" variant="outlined" size="large" fullWidth>
            Build my own
          </Button>
        </Stack>
      }
    />
  )
}

export default function WorkoutPlanScreen() {
  const { user, profile } = useAuth()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  // Fires once per mount, independent of how this screen was reached --
  // clears the "New workout plan" notification the same way visiting it
  // always would, bell or not (patches/020).
  const notified = useRef(false)
  const markNotificationsRead = useMutation({ mutationKey: mutationKeys.markNotificationsRead })
  useEffect(() => {
    if (notified.current) return
    notified.current = true
    markNotificationsRead.mutate({ url: '/m/workout' })
  }, [markNotificationsRead])

  if (isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds a good plan, and an error
  // screen instead of that plan is the wrong answer for an offline gym.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />
  if (!data) return <NoPlan hasCoach={Boolean(profile?.assigned_pro_id)} />

  const { plan, sessions, weekStart } = data
  // Status is derived, never read off the row: `workout_sessions.status` is one
  // column that freezes at the first completion, and a plan repeats weekly.
  const states = sessions.map((session) => runStatusOf(session.runs, weekStart))
  const progress = planProgress(states.map(({ status }) => ({ status })))
  const subtitle = [plan.goal, plan.level].filter(Boolean).join(' - ')
  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Workout Plan</Typography>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" component="h3">{plan.name}</Typography>
              {subtitle ? (
                <Typography color="primary">{subtitle}</Typography>
              ) : null}
            </Box>

          </Stack>

          {/* Two columns on any phone wide enough, stacked below that -- the
              labels are short but "Duration: 6 weeks" still wraps badly at 320px. */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              rowGap: 0.5,
              columnGap: 2,
              mt: 2,
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
              aria-label={`${progress.completed} of ${progress.total} sessions completed this week`}
              sx={{ height: 8, borderRadius: 999 }}
            />
            {/* "This week" is the whole point: the bar empties every Monday.
                Early stops are disclosed without pretending they filled a
                complete session. */}
            <Typography variant="body2" color="text.secondary" aria-hidden sx={{ mt: 0.5 }}>
              {progress.completed} of {progress.total} sessions completed this week
            </Typography>
            {progress.partial > 0 ? (
              <Typography variant="body2" color="warning.main" sx={{ mt: 0.25 }}>
                {progress.partial} {progress.partial === 1 ? 'session' : 'sessions'} stopped early
              </Typography>
            ) : null}
          </Box>
        </CardContent>
      </Card>

      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h2">Training Sessions</Typography>
        </Stack>

        {sessions.length === 0 ? (
          <EmptyState
            title="This plan has no sessions"
            description="Your coach still has to add the first complete session."
          />
        ) : (
          <Stack spacing={2}>
            {sessions.map((session, index) => (
              <SessionCard
                key={session.id}
                session={session}
                status={states[index].status}
                run={states[index].run}
                to={`/m/workout/session/${session.id}`}
              />
            ))}
          </Stack>
        )}

      </Box>

      <Divider />

      <Button component={Link} to="/m/workout/builder" variant="outlined" size="large" fullWidth>
        Create replacement plan
      </Button>
    </Stack>
  )
}
