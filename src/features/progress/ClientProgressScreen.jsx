import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip,
  LinearProgress, Stack, TextField, Typography,
} from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { fetchBodyMetrics } from '../../data/progress.js'
import { fetchOpenRun, fetchRunsSince } from '../../data/runs.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { formatDate, localDayISO, todayISO } from '../../lib/format.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { formatElapsed } from '../workout/timer.js'
import { runDurationMs, weightTrend, workoutWeekSummary } from './progress.js'

/** Thirty days back, as `'YYYY-MM-DD'`. Wide enough for the week plus context. */
function thirtyDaysAgoISO() {
  const now = new Date()
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
  return then.toISOString()
}

/** One small labelled figure, as the Stats Row wireframe draws it. */
function Stat({ label, children }) {
  return (
    <Card sx={{ flexGrow: 1, minWidth: 0 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {children}
      </CardContent>
    </Card>
  )
}

const outcomeLabels = {
  completed: 'Completed',
  partial: 'Partial',
  abandoned: 'Abandoned',
}

function WorkoutRunCard({ clientId, run }) {
  const duration = runDurationMs(run)
  const content = (
    <CardContent>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h3" noWrap>
            {run.session?.name ?? 'Workout session'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatDate(localDayISO(run.started_at))}
            {duration === null ? ' · In progress' : ` · ${formatElapsed(duration)}`}
          </Typography>
          {run.note ? (
            <Typography variant="body2" sx={{ mt: 1 }} noWrap>
              &ldquo;{run.note}&rdquo;
            </Typography>
          ) : null}
        </Box>
        <Chip
          size="small"
          color={run.outcome === 'completed' ? 'success' : run.outcome === 'abandoned' ? 'default' : 'warning'}
          label={duration === null ? 'In progress' : `${outcomeLabels[run.outcome] ?? 'Closed'} · ${run.pct ?? 0}%`}
          sx={{ alignSelf: 'flex-start' }}
        />
      </Stack>
    </CardContent>
  )

  return (
    <Card>
      {duration === null ? content : (
        <CardActionArea component={Link} to={`/p/clients/${clientId}/progress/run/${run.id}`}>
          {content}
        </CardActionArea>
      )}
    </Card>
  )
}

export default function ClientProgressScreen() {
  const { clientId } = useParams()
  const today = todayISO()
  const [sinceISO] = useState(thirtyDaysAgoISO)

  const [weight, setWeight] = useState('')
  const [note, setNote] = useState('')

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
    refetchInterval: 60_000,
  })

  const training = useQuery({
    queryKey: queryKeys.runsSince(clientId, sinceISO),
    queryFn: () => fetchRunsSince(clientId, sinceISO),
    refetchInterval: 60_000,
  })

  const openRun = useQuery({
    queryKey: queryKeys.openRun(clientId),
    queryFn: () => fetchOpenRun(clientId),
    refetchInterval: 60_000,
  })

  const metrics = useQuery({
    queryKey: queryKeys.bodyMetrics(clientId),
    queryFn: () => fetchBodyMetrics(clientId),
  })

  const saveMetric = useMutation({ mutationKey: mutationKeys.saveBodyMetric })

  // `plan` must gate the loading state too: while it is still in flight,
  // `weeklyTraining` gets `0` for the target, which prints "No plan assigned"
  // -- indistinguishable from a client who genuinely has none.
  if (client.isPending || training.isPending || openRun.isPending || metrics.isPending || plan.isPending) {
    return <LoadingState />
  }
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }
  if (training.isError && training.data === undefined) {
    return <ErrorState error={training.error} onRetry={training.refetch} />
  }
  if (metrics.isError && metrics.data === undefined) {
    return <ErrorState error={metrics.error} onRetry={metrics.refetch} />
  }
  if (openRun.isError && openRun.data === undefined) {
    return <ErrorState error={openRun.error} onRetry={openRun.refetch} />
  }
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }

  const allRuns = openRun.data && !training.data.some((run) => run.id === openRun.data.id)
    ? [openRun.data, ...training.data]
    : training.data
  const week = workoutWeekSummary(allRuns, plan.data?.sessions.length ?? 0, today)
  const trend = weightTrend(metrics.data)
  const latestNote = metrics.data.find((metric) => metric.note)
  const recentRuns = allRuns.slice(0, 5)

  const savedOffline = saveMetric.isPending && saveMetric.isPaused

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      {/* No manual refresh control: `plan`, `training` and `openRun` already
          poll every 60s, so the button asked the user to do what the screen
          does on its own -- and it had no pending state, so pressing it looked
          like nothing happened. */}
      <PageHeader
        title="Progress"
        subtitle={client.data.full_name}
        backTo={`/p/clients/${clientId}`}
        backLabel={`Back to ${client.data.full_name}`}
      />

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Workout Tracking
        </Typography>

        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
              <Typography variant="h3" sx={{ flexGrow: 1 }}>
                This Week&rsquo;s Goal
              </Typography>
              <Typography variant="body2" color="primary">
                {week.done}/{week.total} completed
              </Typography>
            </Stack>

            {week.total === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No plan assigned, so there is no weekly target yet.
              </Typography>
            ) : (
              // The dots repeat what the count above already says, so they are
              // decoration: hidden from readers rather than announced as a row
              // of unlabelled shapes.
              <Stack direction="row" spacing={1.5} sx={{ mt: 2 }} aria-hidden>
                {Array.from({ length: week.total }, (_unused, index) => (
                  <Box
                    key={index}
                    sx={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      bgcolor: index < week.done ? 'primary.main' : 'action.disabledBackground',
                    }}
                  />
                ))}
              </Stack>
            )}
            {week.total > 0 ? (
              <Stack spacing={1} sx={{ mt: 2 }}>
                <LinearProgress
                  variant="determinate"
                  value={week.percent}
                  aria-label={`${week.done} of ${week.total} weekly sessions completed`}
                />
                <Typography variant="body2" color="text.secondary">
                  {week.completed} completed · {week.partial} partial · {week.todo} to do
                </Typography>
              </Stack>
            ) : null}
          </CardContent>
        </Card>

        {week.lastRun?.note ? (
          <Card sx={{ mt: 2, borderColor: 'primary.main' }}>
            <CardContent>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ alignItems: { xs: 'flex-start', sm: 'baseline' } }}
              >
                <Typography variant="h3" sx={{ flexGrow: 1 }}>
                  Latest Session Note
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {formatDate(localDayISO(week.lastRun.started_at))}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {week.lastRun.session?.name ?? 'Workout session'}
              </Typography>
              <Typography sx={{ mt: 1, fontStyle: 'italic' }}>
                &ldquo;{week.lastRun.note}&rdquo;
              </Typography>
            </CardContent>
          </Card>
        ) : null}
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Recent Workouts
        </Typography>
        {recentRuns.length === 0 ? (
          <EmptyState
            title="No workouts recorded yet"
            description="The client&rsquo;s sessions will appear here after they start training."
          />
        ) : (
          <Stack spacing={1.5}>
            {recentRuns.map((run) => (
              <WorkoutRunCard key={run.id} clientId={clientId} run={run} />
            ))}
          </Stack>
        )}
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Body &amp; Nutrition Check-in
        </Typography>

        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'stretch' }}>
            <Stat label="Current Weight">
              <Typography variant="h2" component="p">
                {trend.current === null ? '—' : `${trend.current} kg`}
              </Typography>
            </Stat>

            <Stat label="Weekly Trend">
              {trend.deltaKg === null ? (
                <Typography variant="h2" component="p" color="text.secondary">
                  —
                </Typography>
              ) : (
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  {trend.direction === 'down' ? (
                    <ArrowDownwardIcon color="primary" titleAccess="Down" />
                  ) : trend.direction === 'up' ? (
                    <ArrowUpwardIcon color="primary" titleAccess="Up" />
                  ) : null}
                  <Typography
                    variant="h2"
                    component="p"
                    color="text.primary"
                  >
                    {trend.deltaKg > 0 ? '+' : ''}
                    {trend.deltaKg} kg
                  </Typography>
                </Stack>
              )}
            </Stat>
          </Stack>

          {latestNote ? (
            <Card sx={{ borderColor: 'success.main' }}>
              <CardContent>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  sx={{ alignItems: { xs: 'flex-start', sm: 'baseline' } }}
                >
                  <Typography variant="h3" sx={{ flexGrow: 1 }}>
                    Weekly Check-In Note
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatDate(latestNote.measured_on)}
                  </Typography>
                </Stack>
                <Typography sx={{ mt: 1, fontStyle: 'italic' }}>
                  &ldquo;{latestNote.note}&rdquo;
                </Typography>
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              title="No check-in notes yet"
              description="Record a measurement below to start the history."
            />
          )}
        </Stack>
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Record today&rsquo;s check-in
        </Typography>

        <Card>
          <CardContent>
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault()
                saveMetric.mutate(
                  {
                    memberId: clientId,
                    measuredOn: today,
                    weightKg: weight === '' ? null : Number(weight),
                    note,
                  },
                  {
                    onSuccess: () => {
                      setWeight('')
                      setNote('')
                    },
                  },
                )
              }}
            >
              <TextField
                label="Weight (kg)"
                type="number"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                slotProps={{ htmlInput: { inputMode: 'decimal', step: 0.1, min: 20, max: 400 } }}
                fullWidth
              />
              <TextField
                label="Note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Diet adherence, energy, sleep…"
                multiline
                minRows={2}
                fullWidth
              />

              {savedOffline ? (
                <Alert severity="info">
                  You are offline. This check-in is saved on your device and will sync when you
                  reconnect.
                </Alert>
              ) : null}
              {saveMetric.isError ? (
                <Alert severity="error">
                  {saveMetric.error?.message ?? 'The check-in could not be saved.'}
                </Alert>
              ) : null}
              {saveMetric.isSuccess ? (
                <Alert severity="success">
                  Today&rsquo;s check-in is saved. Empty fields kept their existing values.
                </Alert>
              ) : null}

              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={saveMetric.isPending || (weight === '' && note.trim() === '')}
              >
                {savedOffline ? 'Saved offline' : saveMetric.isPending ? 'Saving…' : 'Save check-in'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  )
}
