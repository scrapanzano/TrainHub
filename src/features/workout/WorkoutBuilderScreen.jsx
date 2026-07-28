import { useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, IconButton, Stack, TextField, Typography,
} from '@mui/material'
// `DeleteOutline` (the base/filled-style glyph) is not shipped by the installed
// @mui/icons-material@9.2.0; only the styled variants exist, so this uses the
// `Outlined`-style rendering of the `Delete` glyph instead.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchActivePlan, fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function WorkoutBuilderScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [rows, setRows] = useState([])
  const [picked, setPicked] = useState(null)

  const plan = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const create = useMutation({ mutationKey: mutationKeys.createSession })

  // Offline this mutation pauses: `onSuccess` never runs, no error is raised,
  // and the button would sit on "Saving…" forever with nothing to explain it.
  const savedOffline = create.isPending && create.isPaused

  if (plan.isPending || catalogue.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }
  if (catalogue.isError && catalogue.data === undefined) {
    return <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  }
  if (!plan.data) {
    return (
      <EmptyState
        title="No plan to add to"
        description="Your trainer has not assigned you a plan yet. Sessions belong to a plan."
      />
    )
  }

  const addRow = () => {
    if (!picked) return
    setRows((current) => [...current, { exercise: picked, targetSets: 3, targetReps: 10 }])
    setPicked(null)
  }

  const updateRow = (index, field, value) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [field]: Number(value) } : row)),
    )

  const removeRow = (index) => setRows((current) => current.filter((_, i) => i !== index))

  const onSubmit = (event) => {
    event.preventDefault()

    create.mutate(
      {
        planId: plan.data.plan.id,
        name,
        // One past the highest position in use, not `length + 1`.  The two
        // agree only while positions run contiguously from 1, and `unique
        // (plan_id, position)` rejects a reused one -- so the moment a session
        // is ever deleted, counting would land on a position still occupied and
        // every later add for that plan would fail.
        position: Math.max(0, ...plan.data.sessions.map((session) => session.position)) + 1,
        exercises: rows.map((row, index) => ({
          exerciseId: row.exercise.id,
          position: index + 1,
          targetSets: row.targetSets,
          targetReps: row.targetReps,
        })),
      },
      { onSuccess: () => navigate('/m/workout', { replace: true }) },
    )
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">New session</Typography>

      <TextField
        label="Session name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Push Day"
        required
        fullWidth
      />

      <Stack direction="row" spacing={1}>
        <Autocomplete
          options={catalogue.data}
          getOptionLabel={(option) => option.name}
          groupBy={(option) => option.muscle_group}
          value={picked}
          onChange={(_event, value) => setPicked(value)}
          renderInput={(params) => <TextField {...params} label="Add an exercise" />}
          sx={{ flexGrow: 1 }}
        />
        <Button onClick={addRow} disabled={!picked} variant="outlined">
          Add
        </Button>
      </Stack>

      {rows.length === 0 ? (
        <EmptyState
          title="No exercises yet"
          description="Pick from the catalogue above to build the session."
        />
      ) : (
        <Stack spacing={2}>
          {rows.map((row, index) => (
            <Card key={`${row.exercise.id}-${index}`}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>
                      {row.exercise.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {row.exercise.muscle_group}
                    </Typography>
                  </Box>

                  <TextField
                    label="Sets"
                    type="number"
                    value={row.targetSets}
                    onChange={(event) => updateRow(index, 'targetSets', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 20 } }}
                    sx={{ width: 88 }}
                  />
                  <TextField
                    label="Reps"
                    type="number"
                    value={row.targetReps}
                    onChange={(event) => updateRow(index, 'targetReps', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 100 } }}
                    sx={{ width: 88 }}
                  />

                  <IconButton
                    onClick={() => removeRow(index)}
                    aria-label={`Remove ${row.exercise.name}`}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {savedOffline ? (
        <Alert severity="info">
          You are offline. This session is saved on your device and will be added to your plan when
          you reconnect.
        </Alert>
      ) : null}

      {/* Without this the button simply returns from "Saving…" to "Save
          session" and the member is left believing the write went through. */}
      {create.isError ? (
        <Alert severity="error">
          {create.error?.message ?? 'The session could not be saved. Try again.'}
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={rows.length === 0 || create.isPending}
      >
        {create.isPending ? 'Saving…' : 'Save session'}
      </Button>
    </Stack>
  )
}
