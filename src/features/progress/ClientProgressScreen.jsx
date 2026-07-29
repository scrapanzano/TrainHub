import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Stack, TextField, Typography,
} from '@mui/material'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { fetchBodyMetrics, fetchClientTraining } from '../../data/progress.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { formatDate, todayISO } from '../../lib/format.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import { weeklyTraining, weightTrend } from './progress.js'

/** Thirty days back, as `'YYYY-MM-DD'`. Wide enough for the week plus context. */
function thirtyDaysAgoISO() {
  const now = new Date()
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
  return then.toISOString()
}

/** One small labelled figure, as the Stats Row wireframe draws it. */
function Stat({ label, children }) {
  return (
    <Card sx={{ flexGrow: 1, minWidth: 140 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {children}
      </CardContent>
    </Card>
  )
}

export default function ClientProgressScreen() {
  const { clientId } = useParams()
  const { user } = useAuth()
  const today = todayISO()

  const [weight, setWeight] = useState('')
  const [note, setNote] = useState('')

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  const training = useQuery({
    queryKey: queryKeys.clientTraining(clientId),
    queryFn: () => fetchClientTraining(clientId, thirtyDaysAgoISO()),
  })

  const metrics = useQuery({
    queryKey: queryKeys.bodyMetrics(clientId),
    queryFn: () => fetchBodyMetrics(clientId),
  })

  const saveMetric = useMutation({ mutationKey: mutationKeys.saveBodyMetric })

  // `plan` must gate the loading state too: while it is still in flight,
  // `weeklyTraining` gets `0` for the target, which prints "No plan assigned"
  // -- indistinguishable from a client who genuinely has none.
  if (training.isPending || metrics.isPending || plan.isPending) return <LoadingState />
  if (training.isError && training.data === undefined) {
    return <ErrorState error={training.error} onRetry={training.refetch} />
  }
  if (metrics.isError && metrics.data === undefined) {
    return <ErrorState error={metrics.error} onRetry={metrics.refetch} />
  }

  const week = weeklyTraining(training.data, plan.data?.sessions.length ?? 0, today)
  const trend = weightTrend(metrics.data)
  const latestNote = metrics.data.find((metric) => metric.note)

  const savedOffline = saveMetric.isPending && saveMetric.isPaused

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Progress Tracking</Typography>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Workout Tracking
        </Typography>

        <Card>
          <CardContent>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="h3" sx={{ flexGrow: 1 }}>
                This Week&rsquo;s Goal
              </Typography>
              <Typography variant="body2" color="primary">
                {week.done}/{week.total} Sessions
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
                      bgcolor: index < week.days.length ? 'primary.main' : 'action.disabledBackground',
                    }}
                  />
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Body &amp; Nutrition Check-in
        </Typography>

        <Stack spacing={2}>
          <Stack direction="row" spacing={2}>
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
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {trend.direction === 'down' ? (
                    <ArrowDownwardIcon color="success" titleAccess="Down" />
                  ) : trend.direction === 'up' ? (
                    <ArrowUpwardIcon color="warning" titleAccess="Up" />
                  ) : null}
                  <Typography
                    variant="h2"
                    component="p"
                    color={trend.direction === 'down' ? 'success.main' : 'text.primary'}
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
                <Stack direction="row" spacing={2} alignItems="baseline">
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
                    recordedById: user.id,
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
