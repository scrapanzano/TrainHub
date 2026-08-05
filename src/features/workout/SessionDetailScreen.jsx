import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, IconButton, Menu, MenuItem, Stack, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { fetchActivePlan, fetchSession } from '../../data/workouts.js'
import { fetchOpenRun, fetchRunLogs, fetchRunsSince } from '../../data/runs.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { todayISO } from '../../lib/format.js'
import { daysBefore, mondayOf, runStatusOf } from '../../lib/week.js'
import { elapsedMs } from './timer.js'
import { sessionStatusOf } from './status.js'
import OpenRunSheet from './OpenRunSheet.jsx'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function SessionDetailScreen() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()

  const [menuAnchor, setMenuAnchor] = useState(null)
  const [editing, setEditing] = useState(false)
  const [confirmStart, setConfirmStart] = useState(false)
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

  // The author check needs the plan, which is almost always already cached from
  // the screen the member arrived from.
  const plan = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  const start = useMutation({ mutationKey: mutationKeys.startRun })
  const end = useMutation({ mutationKey: mutationKeys.endRun })
  const removeExercise = useMutation({ mutationKey: mutationKeys.deleteSessionExercise })

  if (isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the answer, and an error
  // screen instead of that answer is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const { session, exercises } = data
  const mine = (runs.data ?? []).filter((run) => run.session_id === sessionId)
  const { status } = runStatusOf(mine, weekStart)
  const { label, color } = sessionStatusOf(status)

  const open = openRun.data ?? null
  const openHere = open?.session_id === sessionId
  const openElsewhere = Boolean(open) && !openHere
  const isAuthor = plan.data?.plan?.author?.id === user.id

  const goLive = () => navigate(`/m/workout/session/${sessionId}/live`)

  const beginRun = () => {
    // Generated in the handler, never during render: `react-hooks/purity`
    // forbids both `crypto.randomUUID()` and `new Date()` in a render body.
    // The id is also the idempotency key `startRun` upserts on, so a replay
    // cannot open a second run and trip the one-open-run index.
    start.mutate({
      id: crypto.randomUUID(),
      sessionId,
      memberId: user.id,
      startedAt: new Date().toISOString(),
    })
    // Navigate now rather than in `onSuccess`.  Offline the mutation pauses and
    // `onSuccess` never fires, leaving the member on a button that did nothing;
    // and online it would fire minutes later, yanking back anyone who had
    // navigated elsewhere in the meantime.  The live screen reads the same
    // optimistically-updated cache either way.
    goLive()
  }

  const onPlay = () => {
    if (openHere) return goLive()
    if (openElsewhere) return setOpenRunShownAt(Date.now())
    return setConfirmStart(true)
  }

  const abandonAndStart = () => {
    // Both writes share the `workoutRun` scope, so they are serialised even
    // online: the abandon lands first and releases the one-open-run index
    // before the new run tries to take it.
    end.mutate({ id: open.id, endedAt: new Date().toISOString(), outcome: 'abandoned' })
    setOpenRunShownAt(null)
    beginRun()
  }

  const onDeleteExercise = (item) => {
    if (
      window.confirm(
        `Remove “${item.exercise.name}” from ${session.name}? Any sets you have logged for it go too.`,
      )
    ) {
      removeExercise.mutate({ sessionExerciseId: item.id })
    }
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton component={Link} to="/m/workout" aria-label="Back to plan" edge="start">
              <ArrowBackIosNewIcon fontSize="small" />
            </IconButton>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" component="h1" noWrap>
                {session.name}
              </Typography>
              <Typography color="text.secondary">{exercises.length} exercises</Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Box
                  aria-hidden
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: `${color}.main` }}
                />
                <Typography variant="body2" color="text.secondary">
                  {label}
                </Typography>
              </Stack>
            </Box>

            {/* Editing is hidden entirely while this session is being trained:
                deleting the exercise you are standing in front of is not a
                thing to leave one tap away. */}
            {editing || openHere ? null : (
              <>
                <IconButton
                  onClick={(event) => setMenuAnchor(event.currentTarget)}
                  aria-label="Session options"
                >
                  <MoreVertIcon />
                </IconButton>
                <IconButton
                  onClick={onPlay}
                  aria-label={`Start ${session.name}`}
                  color="primary"
                  size="large"
                  disabled={start.isPending && !start.isPaused}
                >
                  <PlayArrowIcon fontSize="large" />
                </IconButton>
              </>
            )}

            {openHere ? (
              <Button onClick={goLive} variant="contained">
                Resume
              </Button>
            ) : null}
          </Stack>
        </CardContent>
      </Card>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        {isAuthor ? (
          <MenuItem
            onClick={() => {
              setMenuAnchor(null)
              setEditing(true)
            }}
          >
            Edit session
          </MenuItem>
        ) : (
          // Not a silent absence: a member who wonders why they cannot change
          // their coach's prescription deserves the reason.
          <MenuItem disabled>Written by your coach — not editable</MenuItem>
        )}
      </Menu>

      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h2">Exercises</Typography>
          {editing ? (
            <Button onClick={() => setEditing(false)} disabled={removeExercise.isPending}>
              Done
            </Button>
          ) : null}
        </Stack>

        {removeExercise.isError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {removeExercise.error?.message ?? 'The exercise could not be removed.'}
          </Alert>
        ) : null}

        {exercises.length === 0 ? (
          <Alert severity="warning">
            This session has no exercises yet. Add one before training it.
          </Alert>
        ) : (
          <Stack spacing={2}>
            {exercises.map((item) => {
              const body = (
                <CardContent>
                  <Stack direction="row" spacing={2} alignItems="center">
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
                    {editing ? null : <ChevronRightIcon color="primary" />}
                  </Stack>
                </CardContent>
              )

              // In edit mode the card stops being a link: tapping it must not
              // navigate away from the list being edited, and a delete control
              // nested inside a link target is invalid besides.
              return editing ? (
                <Card key={item.id}>
                  <Stack direction="row" alignItems="center">
                    <Box sx={{ flexGrow: 1, minWidth: 0 }}>{body}</Box>
                    <IconButton
                      onClick={() => onDeleteExercise(item)}
                      aria-label={`Remove ${item.exercise.name}`}
                      sx={{ mr: 1 }}
                    >
                      <DeleteOutlineIcon />
                    </IconButton>
                  </Stack>
                </Card>
              ) : (
                <Card key={item.id}>
                  <CardActionArea component={Link} to={`/m/workout/exercise/${item.id}`}>
                    {body}
                  </CardActionArea>
                </Card>
              )
            })}
          </Stack>
        )}

        {editing ? (
          <Button
            component={Link}
            to={`/m/workout/session/${sessionId}/exercise/new`}
            variant="outlined"
            size="large"
            fullWidth
            startIcon={<AddIcon />}
            sx={{ mt: 2 }}
          >
            Add an exercise
          </Button>
        ) : null}
      </Box>

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
