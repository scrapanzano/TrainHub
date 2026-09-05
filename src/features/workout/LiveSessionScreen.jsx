import { useState } from 'react'
import {
  Box, Card, CardActionArea, CardContent, Chip, IconButton, Stack, Typography,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import PauseIcon from '@mui/icons-material/Pause'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import StopIcon from '@mui/icons-material/Stop'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { fetchSession } from '../../data/workouts.js'
import { fetchOpenRun, fetchRunLogs, fetchRunsSince } from '../../data/runs.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { todayISO } from '../../lib/format.js'
import { daysBefore, earnedOn, mondayOf } from '../../lib/week.js'
import { formatElapsed } from './timer.js'
import { setProgress } from './status.js'
import { completionPct, countsByExercise, pointsForRun, runComplete } from './summary.js'
import { useLiveSession } from './useLiveSession.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import CongratsDialog from './CongratsDialog.jsx'
import EndRunSheet from './EndRunSheet.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { isSubscriptionActive } from '../clients/subscription.js'
import { useAuth } from '../auth/useAuth.js'

export default function LiveSessionScreen() {
  const { sessionId } = useParams()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [ending, setEnding] = useState(false)
  const [abandoning, setAbandoning] = useState(false)
  // Set the moment the member commits to finishing, and never cleared: this
  // screen is on its way out and must stop deciding where to send them.
  const [leaving, setLeaving] = useState(false)

  const openRun = useQuery({
    queryKey: queryKeys.openRun(user.id),
    queryFn: () => fetchOpenRun(user.id),
  })

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  const run = openRun.data?.session_id === sessionId ? openRun.data : null

  const logs = useQuery({
    queryKey: queryKeys.runLogs(run?.id),
    queryFn: () => fetchRunLogs(run.id),
    enabled: Boolean(run?.id),
  })

  // This session's earlier runs, only to answer whether today's award has
  // already been collected.  Same key the session screen uses, so it is
  // normally already in cache and costs nothing here.
  const since = daysBefore(mondayOf(todayISO()), 7)
  const priorRuns = useQuery({
    queryKey: queryKeys.runsSince(user.id, since),
    queryFn: () => fetchRunsSince(user.id, since),
  })

  const live = useLiveSession(run, user.id)
  const end = useMutation({ mutationKey: mutationKeys.endRun })

  if (
    isPending
    || openRun.isPending
    || priorRuns.isPending
    || (run && logs.isPending)
  ) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the session, and an error
  // screen instead of the workout is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />
  if (openRun.isError && openRun.data === undefined) {
    return <ErrorState error={openRun.error} onRetry={openRun.refetch} />
  }
  if (priorRuns.isError && priorRuns.data === undefined) {
    return <ErrorState error={priorRuns.error} onRetry={priorRuns.refetch} />
  }
  if (run && logs.isError && logs.data === undefined) {
    return <ErrorState error={logs.error} onRetry={logs.refetch} />
  }

  // No run open for this session: there is nothing live to show.  Sending them
  // to the session screen is better than an empty clock, because that is where
  // the play button is.
  //
  // Not while finishing, though.  `endRun` clears the open run from the cache
  // in its `onMutate`, so this screen re-renders with no run in the same commit
  // as the navigation to the summary -- and a `<Navigate replace>` rendered
  // then REPLACES that summary, landing the member back on the session they
  // just finished. That is what "See how it went" used to do.
  if (!run && !leaving && openRun.data !== undefined) {
    return <Navigate to={`/m/workout/session/${sessionId}`} replace />
  }

  const { session, exercises } = data
  const counts = countsByExercise(logs.data)
  const setCount = (logs.data ?? []).length
  const remaining = exercises.filter(
    (item) => !setProgress(counts[item.id], item.target_sets).complete,
  ).length
  const allDone = runComplete(exercises, counts)
  const pct = completionPct(exercises, counts)

  // One award per session per day.  Training is never blocked -- the run still
  // happens, the sets are still logged, the coach still sees it -- but a second
  // helping of points on the same day is not on offer.
  const alreadyPaid = earnedOn(
    (priorRuns.data ?? []).filter((item) => item.session_id === sessionId),
    todayISO(),
  )
  // A suspended / expired member's run still closes and still reaches the coach,
  // but `close_workout_run_secure` writes no reward row (patches/023). Quote zero
  // so the end-of-workout copy does not promise points that never arrive.
  const membershipActive = isSubscriptionActive(profile, todayISO())
  const points = alreadyPaid || !membershipActive ? 0 : pointsForRun(exercises, counts)

  /** Close the run and leave. Patch 015 creates any reward atomically. */
  const finish = (outcome) => {
    // Before the write, because the write's `onMutate` runs synchronously and
    // re-renders this screen with no open run.
    setLeaving(true)

    end.mutate({
      id: run.id,
      // `memberId` and `sessionId` are not columns this write touches -- the
      // registered `onMutate` needs them to find the shell's cached run and to
      // seed the summary before the server answers.
      memberId: user.id,
      sessionId,
      endedAt: new Date().toISOString(),
      outcome,
      pct,
    })

    // Navigated now rather than in `onSuccess`: offline the write pauses and
    // `onSuccess` never fires, which would strand the member on a workout they
    // have already ended.
    navigate(
      outcome === 'abandoned' ? '/m/workout' : `/m/workout/run/${run.id}/summary`,
      { replace: true },
    )
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      {/* Pinned below the app bar, not at the viewport top: that bar is
          `fixed` and publishes its own height, so `top: 0` slid the clock and
          the stop button underneath it as soon as the exercise list scrolled. */}
      <Card sx={{ position: 'sticky', top: 'var(--trainhub-header-height, 56px)', zIndex: 1 }}>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <IconButton
              component={Link}
              to={`/m/workout/session/${sessionId}`}
              aria-label="Back to session"
              edge="start"
            >
              <ArrowBackIosNewIcon fontSize="small" />
            </IconButton>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" component="h1" noWrap>
                {session.name}
              </Typography>
              <Typography color="text.secondary">{exercises.length} exercises</Typography>
              <Typography color="primary" sx={{ fontWeight: 700 }}>
                {live.paused ? 'PAUSED' : remaining === 0 ? 'ALL DONE' : `${remaining} to go`}
              </Typography>
            </Box>

            {/* The overflow menu is gone while a run is open: editing the
                session you are standing inside is not on offer. */}
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
              <IconButton
                onClick={live.paused ? live.resume : live.pause}
                aria-label={live.paused ? 'Resume session' : 'Pause session'}
                color="primary"
              >
                {live.paused ? <PlayArrowIcon /> : <PauseIcon />}
              </IconButton>
              <IconButton
                onClick={() => setEnding(true)}
                aria-label="End session"
                color="primary"
              >
                <StopIcon />
              </IconButton>
            </Stack>
          </Stack>

          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
            <AccessTimeIcon fontSize="small" color="primary" aria-hidden />
            {/* No aria-label: Typography renders a <p>, whose `generic` role
                prohibits name-from-author, so the label is dropped by several
                screen readers.  The visible text is the accessible content. */}
            <Typography>{formatElapsed(live.elapsed)}</Typography>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Exercises
        </Typography>

        {exercises.length === 0 ? (
          <EmptyState
            title="No exercises yet"
            description="This session has nothing in it to train."
          />
        ) : (
          <Stack spacing={2}>
            {exercises.map((item) => {
              const progress = setProgress(counts[item.id], item.target_sets)

              return (
                <Card
                  key={item.id}
                  // No "current exercise" outline any more.  It imposed an
                  // order the gym does not respect: a machine is occupied, you
                  // do the next thing and come back.  Finished ones fade; none
                  // is singled out as the one you ought to be doing.
                  sx={{ opacity: progress.complete ? 0.6 : 1 }}
                >
                  <CardActionArea component={Link} to={`/m/workout/exercise/${item.id}`}>
                    <CardContent>
                      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                          <Typography variant="h3" noWrap>
                            {item.exercise.name}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {item.exercise.muscle_group}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 0.5 }}>
                            {item.target_sets} sets • {item.target_reps} reps
                          </Typography>
                        </Box>

                        {progress.complete ? (
                          <CheckCircleIcon color="success" titleAccess="Done" />
                        ) : (
                          <Chip label={progress.label} size="small" color="primary" />
                        )}
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              )
            })}
          </Stack>
        )}
      </Box>

      <EndRunSheet
        open={ending}
        onClose={() => setEnding(false)}
        pct={pct}
        points={points}
        alreadyPaid={alreadyPaid}
        membershipInactive={!membershipActive}
        setCount={setCount}
        onFinish={() => finish('partial')}
        onAbandon={() => {
          // Nothing logged means nothing to lose, so the second confirmation
          // would be asking about a cost that does not exist.
          if (setCount === 0) finish('abandoned')
          else setAbandoning(true)
        }}
        pending={end.isPending && !end.isPaused}
      />

      <ConfirmDialog
        open={abandoning}
        title="Abandon this workout?"
        description={`The ${setCount} ${setCount === 1 ? 'set' : 'sets'} you logged stay in your history but count for nothing, and this session goes back to "not done".`}
        confirmLabel="Abandon"
        cancelLabel="Keep training"
        onCancel={() => setAbandoning(false)}
        onConfirm={() => {
          setAbandoning(false)
          finish('abandoned')
        }}
      />

      <CongratsDialog
        open={allDone && !ending}
        sessionName={session.name}
        setCount={setCount}
        points={points}
        alreadyPaid={alreadyPaid}
        membershipInactive={!membershipActive}
        onFinish={() => finish('completed')}
        pending={end.isPending && !end.isPaused}
      />
    </Stack>
  )
}
