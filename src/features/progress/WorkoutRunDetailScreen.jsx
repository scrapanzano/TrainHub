import {
  Box, Card, CardContent, Chip, Divider, IconButton, Stack, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { fetchClient } from '../../data/clients.js'
import { fetchRun, fetchRunLogs } from '../../data/runs.js'
import { fetchSession } from '../../data/workouts.js'
import { formatDate, localDayISO } from '../../lib/format.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatElapsed } from '../workout/timer.js'
import { runDurationMs } from './progress.js'

const outcomeLabels = {
  completed: 'Completed',
  partial: 'Partial',
  abandoned: 'Abandoned',
}

function ExerciseResult({ item, logs }) {
  const completed = Math.min(logs.length, item.target_sets)
  const missing = Math.max(0, item.target_sets - logs.length)

  return (
    <Card>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h3">{item.exercise.name}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Prescribed: {item.target_sets} sets × {item.target_reps} reps
              {item.target_weight === null ? '' : ` · ${item.target_weight} kg`}
              {item.rest_seconds ? ` · ${item.rest_seconds}s rest` : ''}
            </Typography>
          </Box>
          <Chip
            size="small"
            color={missing === 0 ? 'success' : completed > 0 ? 'warning' : 'default'}
            label={`${completed}/${item.target_sets} sets`}
          />
        </Stack>

        {item.notes ? (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            Coach note: {item.notes}
          </Typography>
        ) : null}

        <Divider sx={{ my: 2 }} />
        {logs.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No sets were logged for this exercise.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {logs.map((log) => (
              <Stack
                key={log.id}
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Typography variant="body2">Set {log.set_number}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {log.reps} reps{log.weight === null ? '' : ` · ${log.weight} kg`}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
        {missing > 0 ? (
          <Typography variant="body2" color="warning.main" sx={{ mt: 1.5 }}>
            {missing} prescribed {missing === 1 ? 'set was' : 'sets were'} not logged.
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function WorkoutRunDetailScreen() {
  const { clientId, runId } = useParams()
  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })
  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => fetchRun(runId),
  })
  const session = useQuery({
    queryKey: queryKeys.session(run.data?.session_id),
    queryFn: () => fetchSession(run.data.session_id),
    enabled: Boolean(run.data?.session_id),
  })
  const logs = useQuery({
    queryKey: queryKeys.runLogs(runId),
    queryFn: () => fetchRunLogs(runId),
    enabled: Boolean(run.data),
  })

  if (client.isPending || run.isPending) return <LoadingState />
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }
  if (run.isError && run.data === undefined) {
    return <ErrorState error={run.error} onRetry={run.refetch} />
  }
  if (!run.data || run.data.member_id !== clientId) {
    return (
      <EmptyState
        title="Workout not available"
        description="This workout does not belong to the selected client or no longer exists."
      />
    )
  }
  if (session.isPending || logs.isPending) return <LoadingState />
  if (session.isError && session.data === undefined) {
    return <ErrorState error={session.error} onRetry={session.refetch} />
  }
  if (logs.isError && logs.data === undefined) {
    return <ErrorState error={logs.error} onRetry={logs.refetch} />
  }

  const duration = runDurationMs(run.data)
  const logsByExercise = new Map()
  for (const log of logs.data) {
    const exerciseLogs = logsByExercise.get(log.session_exercise_id) ?? []
    exerciseLogs.push(log)
    logsByExercise.set(log.session_exercise_id, exerciseLogs)
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton
          component={Link}
          to={`/p/clients/${clientId}/progress`}
          aria-label="Back to progress tracking"
          edge="start"
        >
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1" noWrap>{run.data.session?.name ?? 'Workout details'}</Typography>
          <Typography color="text.secondary" noWrap>{client.data.full_name}</Typography>
        </Box>
      </Stack>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }} useFlexGap>
              <Chip
                color={run.data.outcome === 'completed' ? 'success' : run.data.outcome === 'partial' ? 'warning' : 'default'}
                label={duration === null ? 'In progress' : outcomeLabels[run.data.outcome] ?? 'Closed'}
              />
              {duration !== null ? <Chip variant="outlined" label={`${run.data.pct ?? 0}%`} /> : null}
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {formatDate(localDayISO(run.data.started_at))}
              {duration === null ? '' : ` · Active time ${formatElapsed(duration)}`}
            </Typography>
            {run.data.note ? (
              <Typography sx={{ fontStyle: 'italic' }}>&ldquo;{run.data.note}&rdquo;</Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">No session note was added.</Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>Exercises</Typography>
        {session.data.exercises.length === 0 ? (
          <EmptyState
            title="No prescribed exercises"
            description="This session did not contain any exercises."
          />
        ) : (
          <Stack spacing={2}>
            {session.data.exercises.map((item) => (
              <ExerciseResult
                key={item.id}
                item={item}
                logs={logsByExercise.get(item.id) ?? []}
              />
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
