import { useState } from 'react'
import {
  Alert, Autocomplete, Button, Stack, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { fetchExerciseCatalogue, fetchSession } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

/**
 * Add one exercise to a session that already exists.
 *
 * Reached from the session screen's edit mode.  The name and muscle group come
 * from the shared catalogue and are not editable here -- they belong to the
 * exercise, not to this prescription of it.  Everything else is the
 * prescription: how many sets, how many reps, how long to rest, and what weight
 * to aim for.
 */
export default function AddExerciseScreen() {
  const { sessionId } = useParams()
  const navigate = useNavigate()

  const [picked, setPicked] = useState(null)
  const [targetSets, setTargetSets] = useState(3)
  const [targetReps, setTargetReps] = useState(10)
  const [restSeconds, setRestSeconds] = useState(90)
  const [targetWeight, setTargetWeight] = useState('')

  const session = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const add = useMutation({ mutationKey: mutationKeys.addSessionExercise })

  if (session.isPending || catalogue.isPending) return <LoadingState />
  if (session.isError && session.data === undefined) {
    return <ErrorState error={session.error} onRetry={session.refetch} />
  }
  // Ungated, `catalogue.data` is undefined and MUI's useAutocomplete calls
  // `options.filter()` the moment the popup opens.  With no errorElement in the
  // route tree that throw replaces the whole app with the root boundary.
  if (catalogue.isError && catalogue.data === undefined) {
    return <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  }

  const onSubmit = (event) => {
    event.preventDefault()
    if (!picked) return

    add.mutate(
      {
        // Client-generated so a replayed write upserts rather than adding the
        // exercise twice.  In the handler, never in render.
        id: crypto.randomUUID(),
        sessionId,
        exerciseId: picked.id,
        // One past the highest in use, not a count: `unique (session_id,
        // position)` rejects a reused position, and counting collides as soon
        // as anything has been removed.
        position: Math.max(0, ...session.data.exercises.map((item) => item.position)) + 1,
        targetSets: Number(targetSets),
        targetReps: Number(targetReps),
        targetWeight: targetWeight === '' ? null : Number(targetWeight),
        restSeconds: Number(restSeconds),
      },
      { onSuccess: () => navigate(`/m/workout/session/${sessionId}`, { replace: true }) },
    )
  }

  const paused = add.isPending && add.isPaused

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">Add an exercise</Typography>
        <Typography color="text.secondary">to {session.data.session.name}</Typography>
      </Stack>

      <Autocomplete
        options={catalogue.data}
        getOptionLabel={(option) => option.name}
        groupBy={(option) => option.muscle_group}
        value={picked}
        onChange={(_event, value) => setPicked(value)}
        renderInput={(params) => <TextField {...params} label="Exercise" required />}
      />

      <Stack direction="row" spacing={2}>
        <TextField
          label="Sets"
          type="number"
          value={targetSets}
          onChange={(event) => setTargetSets(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 20 } }}
          fullWidth
        />
        <TextField
          label="Reps"
          type="number"
          value={targetReps}
          onChange={(event) => setTargetReps(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 100 } }}
          fullWidth
        />
      </Stack>

      <Stack direction="row" spacing={2}>
        <TextField
          label="Rest (seconds)"
          type="number"
          value={restSeconds}
          onChange={(event) => setRestSeconds(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'numeric', min: 0, max: 600, step: 15 } }}
          fullWidth
        />
        <TextField
          label="Target weight (kg)"
          type="number"
          value={targetWeight}
          onChange={(event) => setTargetWeight(event.target.value)}
          slotProps={{ htmlInput: { inputMode: 'decimal', min: 0, max: 999, step: 0.5 } }}
          placeholder="Bodyweight"
          fullWidth
        />
      </Stack>

      {/* Offline the mutation pauses: `onSuccess` never runs, no error is
          raised, and the button would sit on "Adding…" with nothing to explain
          it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. This exercise is saved on your device and will be added when you
          reconnect.
        </Alert>
      ) : null}
      {add.error ? (
        <Alert severity="error">{add.error.message ?? 'The exercise could not be added.'}</Alert>
      ) : null}

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={!picked || add.isPending}
      >
        {paused ? 'Saved offline' : add.isPending ? 'Adding…' : 'Add exercise'}
      </Button>

      <Button onClick={() => navigate(-1)} disabled={add.isPending}>
        Cancel
      </Button>
    </Stack>
  )
}
