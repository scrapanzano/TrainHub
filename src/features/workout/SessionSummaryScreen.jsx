import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSession, fetchSessionLogs } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { pointsForWorkout, summariseSession } from './summary.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

function Stat({ label, value }) {
  return (
    <Stack sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="h2" component="p">
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )
}

export default function SessionSummaryScreen() {
  const { sessionId } = useParams()

  const session = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  const logs = useQuery({
    queryKey: queryKeys.sessionLogs(sessionId),
    queryFn: () => fetchSessionLogs(sessionId),
  })

  if (session.isPending || logs.isPending) return <LoadingState />
  if (session.isError && session.data === undefined) {
    return <ErrorState error={session.error} onRetry={session.refetch} />
  }
  if (logs.isError && logs.data === undefined) {
    return <ErrorState error={logs.error} onRetry={logs.refetch} />
  }

  const stats = summariseSession(session.data.exercises, logs.data)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">Session complete</Typography>
        <Typography color="text.secondary">{session.data.session.name}</Typography>
      </Box>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2}>
            <Stat label="Sets" value={stats.setCount} />
            <Stat label="Reps" value={stats.totalReps} />
            <Stat label="Volume" value={`${stats.volumeKg} kg`} />
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" component="h2">
            Exercises
          </Typography>
          <Typography color="text.secondary">
            {stats.completedCount} of {stats.exerciseCount} completed
            {stats.allComplete ? ' — every prescription met.' : '.'}
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3" component="h2">
            +{pointsForWorkout()} points
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Earned for completing this session.
          </Typography>
          <Button component={Link} to="/m/profile/rewards" variant="outlined" fullWidth>
            View rewards
          </Button>
        </CardContent>
      </Card>

      <Button component={Link} to="/m/workout" variant="contained" size="large" fullWidth>
        Back to plan
      </Button>
    </Stack>
  )
}
