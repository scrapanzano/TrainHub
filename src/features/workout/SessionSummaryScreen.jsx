import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Stack, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSession } from '../../data/workouts.js'
import { fetchRun, fetchRunLogs } from '../../data/runs.js'
import { fetchRewards } from '../../data/rewards.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { todayISO } from '../../lib/format.js'
import { countsByExercise, pointsForRun, summariseSession } from './summary.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { isSubscriptionActive } from '../clients/subscription.js'
import { useAuth } from '../auth/useAuth.js'

function Stat({ label, value }) {
  return (
    <Stack sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="h2" component="p">{value}</Typography>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Stack>
  )
}

/**
 * How one workout went.
 *
 * Keyed on the run, not the session: the same session comes round again every
 * week, and a summary that could only name the session would show this week's
 * numbers under last week's heading.
 */
export default function SessionSummaryScreen() {
  const { runId } = useParams()
  const { user, profile } = useAuth()
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState(false)

  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: () => fetchRun(runId),
  })

  const sessionId = run.data?.session_id ?? null

  const session = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
    enabled: Boolean(sessionId),
  })

  const logs = useQuery({
    queryKey: queryKeys.runLogs(runId),
    queryFn: () => fetchRunLogs(runId),
  })

  const rewards = useQuery({
    queryKey: queryKeys.rewards(user.id),
    queryFn: () => fetchRewards(user.id),
  })

  const saveNote = useMutation({ mutationKey: mutationKeys.saveRunNote })

  if (run.isPending || logs.isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the answer.
  if (run.isError && run.data === undefined) {
    return <ErrorState error={run.error} onRetry={run.refetch} />
  }
  if (!run.data) {
    return (
      <EmptyState
        title="Workout not found"
        description="It may have been removed along with its session."
      />
    )
  }
  if (session.isPending) return <LoadingState />
  if (session.isError && session.data === undefined) {
    return <ErrorState error={session.error} onRetry={session.refetch} />
  }

  const exercises = session.data.exercises
  const stats = summariseSession(exercises, logs.data ?? [])
  const pct = run.data.pct ?? 0

  const estimatedPoints = pointsForRun(exercises, countsByExercise(logs.data))
  const reward = (rewards.data ?? []).find((item) => item.run_id === runId) ?? null
  const rewardPending = !reward
    && (run.data.server_confirmed === false || rewards.isPending || rewards.isFetching)
  // A suspended / expired member gets no reward row (patches/023). With no reward
  // to show, say why plainly instead of quoting an estimate or "already earned".
  const membershipActive = isSubscriptionActive(profile, todayISO())
  const inactiveNoReward = !membershipActive && !reward

  const onSaveNote = (event) => {
    event.preventDefault()
    saveNote.mutate({ id: runId, note }, { onSuccess: () => setSaved(true) })
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">
          {run.data.outcome === 'completed' ? 'Session complete' : 'Session ended'}
        </Typography>
        <Typography color="text.secondary">{run.data.session?.name}</Typography>
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
          <Typography variant="h3">Exercises</Typography>
          <Typography color="text.secondary">
            {stats.completedCount} of {stats.exerciseCount} completed
            {stats.allComplete ? ' — every prescription met.' : ` — ${pct}% of the session.`}
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h3">
            {inactiveNoReward
              ? 'No points this time'
              : rewardPending && estimatedPoints > 0
                ? `Up to +${estimatedPoints} points`
                : reward
                  ? `+${reward.points} points`
                  : 'No points this time'}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {inactiveNoReward
              ? 'No points while your membership is inactive. The workout is saved and your coach still sees it.'
              : rewardPending
                ? 'The workout is saved. The server will confirm the final points when synchronisation completes.'
                : rewards.isError
                  ? 'The workout is saved, but the reward could not be checked yet.'
                  : reward
                    ? run.data.outcome === 'completed'
                      ? 'Confirmed by the server for finishing every prescribed set.'
                      : 'Confirmed by the server and weighted by the prescribed sets completed.'
                    : estimatedPoints === 0
                      ? 'No reward is created when no prescribed sets count.'
                      : 'This session had already earned on that day. The workout still counts.'}
          </Typography>
          <Button component={Link} to="/m/profile/rewards" variant="outlined" fullWidth>
            View rewards
          </Button>
        </CardContent>
      </Card>

      {/* Asked for here and nowhere else.  This is the only moment the member
          still remembers how it went; a note requested later, from a menu, is a
          note nobody writes. */}
      {profile?.assigned_pro_id ? (
        <Card>
          <CardContent component="form" onSubmit={onSaveNote}>
            <Typography variant="h3" sx={{ mb: 1 }}>How did it feel?</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              Optional — anything your coach should know before the next session.
            </Typography>

            <TextField
              value={note}
              onChange={(event) => {
                setNote(event.target.value)
                setSaved(false)
              }}
              placeholder="Left knee twinged on the last set of squats."
              multiline
              minRows={3}
              fullWidth
              slotProps={{ htmlInput: { maxLength: 1000 } }}
            />

            {saveNote.isPending && saveNote.isPaused ? (
              <Alert severity="info" sx={{ mt: 2 }}>
                You are offline. Your note is saved on this device and sent when you reconnect.
              </Alert>
            ) : null}
            {saveNote.isError ? (
              <Alert severity="error" sx={{ mt: 2 }}>
                {saveNote.error?.message ?? 'The note could not be saved.'}
              </Alert>
            ) : null}

            <Button
              type="submit"
              variant="outlined"
              fullWidth
              sx={{ mt: 2 }}
              disabled={note.trim() === '' || saveNote.isPending}
            >
              {saved ? 'Saved' : 'Save note'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Button component={Link} to="/m/workout" variant="contained" size="large" fullWidth replace>
        Back to plan
      </Button>
    </Stack>
  )
}
