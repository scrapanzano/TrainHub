import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, IconButton, Stack, Typography,
} from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { fetchSession } from '../../data/workouts.js'
import { fetchOpenRun, fetchRunLogs, fetchRunsSince } from '../../data/runs.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { todayISO } from '../../lib/format.js'
import { daysBefore, mondayOf, runStatusOf } from '../../lib/week.js'
import { elapsedMs } from './timer.js'
import { sessionStatusOf } from './status.js'
import OpenRunSheet from './OpenRunSheet.jsx'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function SessionDetailScreen() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [confirmStart, setConfirmStart] = useState(false)
  const [emptyWarning, setEmptyWarning] = useState(false)
  // The instant the sheet was opened, captured in the handler.  `Date.now()` in
  // a render body is forbidden by `react-hooks/purity`, and this reading only
  // has to be right when the member looks at it -- it is "running for 23
  // minutes", not a live clock.
  const [openRunShownAt, setOpenRunShownAt] = useState(null)

  const weekStart = mondayOf(todayISO())

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  const runs = useQuery({
    queryKey: queryKeys.runsSince(user.id, daysBefore(weekStart, 7)),
    queryFn: () => fetchRunsSince(user.id, daysBefore(weekStart, 7)),
  })

  const openRun = useQuery({
    queryKey: queryKeys.openRun(user.id),
    queryFn: () => fetchOpenRun(user.id),
  })

  // Only to tell the member what they would be throwing away.  Enabled solely
  // when something is open, so the ordinary case costs no request.
  const openRunLogs = useQuery({
    queryKey: queryKeys.runLogs(openRun.data?.id),
    queryFn: () => fetchRunLogs(openRun.data.id),
    enabled: Boolean(openRun.data?.id),
  })

  const start = useMutation({ mutationKey: mutationKeys.startRun })
  const end = useMutation({ mutationKey: mutationKeys.endRun })

  if (isPending || runs.isPending || openRun.isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the answer, and an error
  // screen instead of that answer is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />
  if (runs.isError && runs.data === undefined) {
    return <ErrorState error={runs.error} onRetry={runs.refetch} />
  }
  if (openRun.isError && openRun.data === undefined) {
    return <ErrorState error={openRun.error} onRetry={openRun.refetch} />
  }

  const { session, exercises } = data
  const mine = (runs.data ?? []).filter((run) => run.session_id === sessionId)
  const { status } = runStatusOf(mine, weekStart)
  const { label, color } = sessionStatusOf(status)

  const open = openRun.data ?? null
  const openHere = open?.session_id === sessionId
  const openElsewhere = Boolean(open) && !openHere

  if (open && openRunLogs.isPending) return <LoadingState />
  if (open && openRunLogs.isError && openRunLogs.data === undefined) {
    return <ErrorState error={openRunLogs.error} onRetry={openRunLogs.refetch} />
  }

  const goLive = () => navigate(`/m/workout/session/${sessionId}/live`)

  const beginRun = () => {
    // Generated in the handler, never during render: `react-hooks/purity`
    // forbids both `createUuid()` and `new Date()` in a render body.
    // The id is also the idempotency key `startRun` upserts on, so a replay
    // cannot open a second run and trip the one-open-run index.
    start.mutate({
      id: createUuid(),
      sessionId,
      memberId: user.id,
      startedAt: new Date().toISOString(),
      // Carried so the registered `onMutate` can put a named run in the cache
      // before the server answers -- the mini-player and the live screen both
      // read it immediately.
      sessionName: session.name,
    })
    // Navigate now rather than in `onSuccess`.  Offline the mutation pauses and
    // `onSuccess` never fires, leaving the member on a button that did nothing;
    // and online it would fire minutes later, yanking back anyone who had
    // navigated elsewhere in the meantime.  The live screen reads the same
    // optimistically-updated cache either way.
    goLive()
  }

  const onPlay = () => {
    // A session with nothing in it cannot be trained, and the play button used
    // to start one anyway -- opening a run against an empty list, which then
    // could only be abandoned.  Explained rather than disabled: a greyed-out
    // button states that something is impossible and never says why.
    if (exercises.length === 0) return setEmptyWarning(true)
    if (openHere) return goLive()
    if (openElsewhere) return setOpenRunShownAt(Date.now())
    return setConfirmStart(true)
  }

  const abandonAndStart = () => {
    // Both writes share the `workoutRun` scope, so they are serialised even
    // online: the abandon lands first and releases the one-open-run index
    // before the new run tries to take it.
    end.mutate({
      id: open.id,
      memberId: user.id,
      sessionId: open.session_id,
      endedAt: new Date().toISOString(),
      outcome: 'abandoned',
    })
    setOpenRunShownAt(null)
    // Ordered by the shared `workoutRun` scope, so the abandon lands first and
    // releases the one-open-run index before this takes it.  In the cache the
    // effect is the same either way: `endRun`'s onMutate clears the open run
    // and `startRun`'s writes the new one, in that order.
    beginRun()
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title={session.name}
        subtitle={`${exercises.length} ${exercises.length === 1 ? 'exercise' : 'exercises'}`}
        backTo="/m/workout"
        backLabel="Back to workout plan"
      />

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h3">Session status</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
                <Box
                  aria-hidden
                  sx={{
                    width: 8, height: 8, borderRadius: '50%',
                    bgcolor: `${color}.main`, flexShrink: 0,
                  }}
                />
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </Stack>
            </Box>

            {openHere ? null : (
              <IconButton
                onClick={onPlay}
                aria-label={`Start ${session.name}`}
                color="primary"
                size="large"
                disabled={start.isPending && !start.isPaused}
              >
                <PlayArrowIcon fontSize="large" />
              </IconButton>
            )}

            {openHere ? (
              <Button onClick={goLive} variant="contained">
                Resume
              </Button>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="h2">Exercises</Typography>
        </Stack>

        {exercises.length === 0 ? (
          <Alert severity="warning">
            This session has no exercises yet. Your coach still has to complete it.
          </Alert>
        ) : (
          <Stack spacing={2}>
            {exercises.map((item) => {
              const body = (
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

                    <Chip label={`${item.rest_seconds}s rest`} size="small" variant="outlined" />
                    <ChevronRightIcon color="primary" />
                  </Stack>
                </CardContent>
              )

              return (
                <Card key={item.id}>
                  <CardActionArea component={Link} to={`/m/workout/exercise/${item.id}`}>
                    {body}
                  </CardActionArea>
                </Card>
              )
            })}
          </Stack>
        )}

      </Box>

      <Dialog open={emptyWarning} onClose={() => setEmptyWarning(false)}>
        <DialogTitle>Nothing to train yet</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {session.name} has no exercises in it. Your coach still has to fill it in.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEmptyWarning(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmStart} onClose={() => setConfirmStart(false)}>
        <DialogTitle>Start {session.name}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The clock starts now and keeps running until you finish. You can pause it at any time.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmStart(false)}>Cancel</Button>
          <Button
            onClick={() => {
              setConfirmStart(false)
              beginRun()
            }}
            variant="contained"
          >
            Start
          </Button>
        </DialogActions>
      </Dialog>

      <OpenRunSheet
        open={openRunShownAt !== null}
        onClose={() => setOpenRunShownAt(null)}
        run={open}
        elapsed={
          open && openRunShownAt !== null
            ? elapsedMs(
                {
                  startedAt: Date.parse(open.started_at),
                  pausedAt: open.paused_at ? Date.parse(open.paused_at) : null,
                  pausedTotal: open.paused_total_ms,
                },
                openRunShownAt,
              )
            : 0
        }
        setCount={(openRunLogs.data ?? []).length}
        onAbandon={abandonAndStart}
        pending={end.isPending && !end.isPaused}
      />
    </Stack>
  )
}
