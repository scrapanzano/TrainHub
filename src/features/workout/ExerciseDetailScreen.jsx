import { useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSessionExercise } from '../../data/workouts.js'
import { fetchOpenRun, fetchRunLogs } from '../../data/runs.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { elapsedMs, formatElapsed } from './timer.js'
import { setProgress } from './status.js'
import RestTimer from './RestTimer.jsx'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/** One prescription line, as a definition list so the pairing survives for a
 *  screen reader instead of collapsing into loose text.  The separator is a
 *  border rather than a <Divider>: a <dl> may only contain dt/dd groups and
 *  their wrapping <div>, and an <hr> between them is invalid markup. */
function Fact({ label, value }) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      sx={{ py: 1, borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}
    >
      <Typography component="dt" color="text.secondary">{label}</Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>{value}</Typography>
    </Stack>
  )
}

/**
 * The exercise illustration.
 *
 * A block built from the theme rather than a file: the wireframes draw a
 * placeholder here, real imagery would need licensing and hosting and would
 * have to fit inside a service-worker precache that has to work in a basement,
 * and none of that buys the member anything the instructions do not.
 * `exercises.image_url` stays in the schema, unused and available.
 */
function ExerciseArt({ muscleGroup }) {
  return (
    <Box
      aria-hidden
      sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1,
        height: 140, borderRadius: 4, bgcolor: 'action.hover', color: 'text.secondary',
      }}
    >
      <FitnessCenterIcon fontSize="large" />
      <Typography variant="h3" component="span">{muscleGroup}</Typography>
    </Box>
  )
}

/** The form for the next set, and the sets already behind it. */
function LogPanel({ item, runId, sessionId, logs, memberId }) {
  const queryClient = useQueryClient()
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')

  const mine = logs.filter((log) => log.session_exercise_id === item.id)
  const progress = setProgress(mine.length, item.target_sets)

  // Guards a double tap within one submit.  Deliberately NOT `isPending`:
  // offline a mutation pauses and stays pending until reconnect, so keying off
  // it would block every set after the first in exactly the situation this
  // feature exists for.
  const submitted = useRef(false)
  useEffect(() => {
    submitted.current = false
  }, [mine.length])

  const logSet = useMutation({
    // No `mutationFn` here on purpose: it is registered against this key in
    // `src/data/mutations.js`, which is also where a mutation restored from
    // IndexedDB after a reload finds it again.  Declaring it here too would
    // create a second source of truth the persister cannot see.
    mutationKey: mutationKeys.logSet,

    onMutate: async (variables) => {
      // Offline this pauses and settles minutes later.  Writing the row now is
      // what moves the counter the moment the button is tapped -- otherwise
      // nothing happens and the set gets logged twice.
      await queryClient.cancelQueries({ queryKey: queryKeys.runLogs(runId) })
      queryClient.setQueryData(queryKeys.runLogs(runId), (current) =>
        current ? [...current, variables.optimistic] : current,
      )
    },

    onError: (_error, variables) => {
      // Remove just this row rather than restoring a snapshot.  With two writes
      // in flight, an earlier failure restoring its own snapshot would clobber
      // the later one's optimistic state; reversing one delta cannot.
      queryClient.setQueryData(queryKeys.runLogs(runId), (current) =>
        current ? current.filter((log) => log.id !== variables.id) : current,
      )
    },
  })

  if (progress.complete) {
    return (
      <Alert severity="success" icon={<CheckCircleIcon />}>
        All {item.target_sets} sets done. Nothing left to log here.
      </Alert>
    )
  }

  const onSubmit = (event) => {
    event.preventDefault()
    if (submitted.current) return
    submitted.current = true

    // Both generated in the handler: `react-hooks/purity` forbids
    // `crypto.randomUUID()` and `new Date()` in a render body.  The id is the
    // idempotency key a replayed write upserts on, and the timestamp is the
    // caller's because this write may sit paused for hours -- the database's
    // `now()` would record an 18:00 set as happening at 23:00.
    const id = crypto.randomUUID()
    const performedAt = new Date().toISOString()
    const parsedWeight = weight === '' ? null : Number(weight)

    logSet.mutate({
      id,
      runId,
      sessionId,
      sessionExerciseId: item.id,
      memberId,
      setNumber: mine.length + 1,
      reps: Number(reps),
      weight: parsedWeight,
      performedAt,
      optimistic: {
        id,
        session_exercise_id: item.id,
        set_number: mine.length + 1,
        reps: Number(reps),
        weight: parsedWeight,
        performed_at: performedAt,
      },
    })

    setReps('')
    // The weight is deliberately kept: the next set is almost always at the
    // same load, and retyping it every time is the fastest way to make a
    // member stop logging.
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={2}>
      <Typography variant="h3">
        Set {mine.length + 1} of {item.target_sets}
      </Typography>

      <Stack direction="row" spacing={2}>
        <TextField
          label="Reps"
          type="number"
          value={reps}
          onChange={(event) => setReps(event.target.value)}
          // `inputMode` is what actually summons the numeric keypad on a phone;
          // type="number" alone gives a full keyboard on some Androids.
          slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 999 } }}
          placeholder={String(item.target_reps)}
          required
          fullWidth
        />
        <TextField
          label="Weight (kg)"
          type="number"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'decimal', step: 0.5, min: 0, max: 999 } }}
          placeholder={item.target_weight ? String(item.target_weight) : 'Bodyweight'}
          fullWidth
        />
      </Stack>

      <Button type="submit" variant="contained" size="large" fullWidth>
        Log set
      </Button>
    </Stack>
  )
}

export default function ExerciseDetailScreen() {
  const { sessionExerciseId } = useParams()
  const { user } = useAuth()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.sessionExercise(sessionExerciseId),
    queryFn: () => fetchSessionExercise(sessionExerciseId),
  })

  const openRun = useQuery({
    queryKey: queryKeys.openRun(user.id),
    queryFn: () => fetchOpenRun(user.id),
  })

  const sessionId = data?.session?.id ?? null
  // Live only when the run belongs to THIS exercise's session.  Opening an
  // exercise from another session while training must not offer to log into it.
  const run = openRun.data?.session_id && openRun.data.session_id === sessionId
    ? openRun.data
    : null

  const logs = useQuery({
    queryKey: queryKeys.runLogs(run?.id),
    queryFn: () => fetchRunLogs(run.id),
    enabled: Boolean(run?.id),
  })

  const [now, setNow] = useState(() => Date.now())
  const ticking = Boolean(run) && !run.paused_at
  useEffect(() => {
    if (!ticking) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])

  if (isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the answer, and an error
  // screen instead of that answer is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const { exercise, session } = data
  const mineCount = (logs.data ?? []).filter(
    (log) => log.session_exercise_id === sessionExerciseId,
  ).length
  const progress = setProgress(run ? mineCount : 0, data.target_sets)

  const elapsed = run
    ? elapsedMs(
        {
          startedAt: Date.parse(run.started_at),
          pausedAt: run.paused_at ? Date.parse(run.paused_at) : null,
          pausedTotal: run.paused_total_ms ?? 0,
        },
        now,
      )
    : 0

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      {/* While a run is open the clock comes with you.  Losing sight of it on
          the screen where a set is logged is how a member ends up with a
          workout that ran for two hours. */}
      {run ? (
        <Card sx={{ position: 'sticky', top: 0, zIndex: 1 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <IconButton
                component={Link}
                to={`/m/workout/session/${session.id}/live`}
                aria-label={`Back to ${session.name}`}
                edge="start"
              >
                <ArrowBackIosNewIcon fontSize="small" />
              </IconButton>
              <Typography variant="h3" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                {session.name}
              </Typography>
              <AccessTimeIcon fontSize="small" color="primary" aria-hidden />
              <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatElapsed(elapsed)}
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ) : (
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton
            component={Link}
            to={`/m/workout/session/${session.id}`}
            aria-label={`Back to ${session.name}`}
            edge="start"
          >
            <ArrowBackIosNewIcon fontSize="small" />
          </IconButton>
          <Typography variant="body2" color="text.secondary" noWrap>
            {session.name}
          </Typography>
        </Stack>
      )}

      <Box>
        <Typography variant="h1" sx={{ mb: 2 }}>{exercise.name}</Typography>
        <ExerciseArt muscleGroup={exercise.muscle_group} />
      </Box>

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={exercise.muscle_group} />
        {exercise.equipment ? <Chip label={exercise.equipment} variant="outlined" /> : null}
        {run ? (
          <Chip
            label={`${progress.label} sets logged`}
            color={progress.complete ? 'success' : 'primary'}
          />
        ) : null}
      </Stack>

      <Card>
        <CardContent component="dl" sx={{ m: 0 }}>
          <Fact label="Sets" value={data.target_sets} />
          <Fact label="Reps" value={data.target_reps} />
          {data.target_weight ? <Fact label="Weight" value={`${data.target_weight} kg`} /> : null}
          <Fact label="Rest" value={`${data.rest_seconds}s`} />
        </CardContent>
      </Card>

      {/* The logging half exists only while this exercise's session is being
          trained.  Outside a run the screen is the reference card it has always
          been. */}
      {run ? (
        <>
          <Card>
            <CardContent>
              <LogPanel
                item={data}
                runId={run.id}
                sessionId={session.id}
                logs={logs.data ?? []}
                memberId={user.id}
              />
            </CardContent>
          </Card>

          {mineCount > 0 ? (
            <Card variant="outlined">
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1 }}>Today</Typography>
                <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 0, listStyle: 'none' }}>
                  {(logs.data ?? [])
                    .filter((log) => log.session_exercise_id === sessionExerciseId)
                    .map((log) => (
                      <Stack
                        key={log.id}
                        component="li"
                        direction="row"
                        justifyContent="space-between"
                      >
                        <Typography color="text.secondary">Set {log.set_number}</Typography>
                        <Typography sx={{ fontWeight: 600 }}>
                          {log.reps} reps
                          {log.weight == null ? ' • bodyweight' : ` • ${log.weight} kg`}
                        </Typography>
                      </Stack>
                    ))}
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          <RestTimer seconds={data.rest_seconds} />
        </>
      ) : null}

      {exercise.instructions ? (
        <Box>
          <Typography variant="h2" sx={{ mb: 1 }}>How to perform</Typography>
          <Typography color="text.secondary">{exercise.instructions}</Typography>
        </Box>
      ) : null}

      {data.notes ? (
        <Box>
          <Typography variant="h2" sx={{ mb: 1 }}>Trainer&apos;s note</Typography>
          <Typography color="text.secondary">{data.notes}</Typography>
        </Box>
      ) : null}
    </Stack>
  )
}
