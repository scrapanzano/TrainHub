import { useState } from 'react'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, IconButton, Stack, TextField, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { EmptyState } from '../../components/ScreenState.jsx'

/**
 * Build one session: a name and an ordered list of prescribed exercises.
 *
 * Shared by the member's own wizard and the professional's plan wizard,
 * because both produce exactly the same session payload. The form owns
 * only its draft state; who is being written for, and what happens on
 * success, belong to the caller.
 *
 * @param {object}   props
 * @param {Array}    props.catalogue   Exercises to choose from. Never undefined.
 * @param {Function} props.onSubmit    `({name, exercises}) => void`
 * @param {boolean}  props.pending     A save is in flight.
 * @param {boolean}  props.paused      The save is parked offline.
 * @param {?Error}   props.error       The last failure, if any.
 * @param {string}   props.submitLabel Idle label for the button.
 * @param {?object}  props.initial     `{name, exercises}` to reopen with, editing a
 *   drafted session from the summary. `exercises` is shaped the way this
 *   form's own `onSubmit` produces it.
 */
export default function SessionForm({
  catalogue,
  onSubmit,
  pending = false,
  paused = false,
  error = null,
  submitLabel = 'Save session',
  initial = null,
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [rows, setRows] = useState(() =>
    (initial?.exercises ?? []).map((item) => ({
      exercise: catalogue.find((option) => option.id === item.exerciseId),
      targetSets: item.targetSets,
      targetReps: item.targetReps,
      targetWeight: item.targetWeight ?? '',
      restSeconds: item.restSeconds,
      notes: item.notes ?? '',
    })),
  )
  const [picked, setPicked] = useState(null)

  const addRow = () => {
    if (!picked) return
    setRows((current) => [...current, {
      exercise: picked,
      targetSets: 3,
      targetReps: 10,
      targetWeight: '',
      restSeconds: 90,
      notes: '',
    }])
    setPicked(null)
  }

  const updateRow = (index, field, value) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    )

  const removeRow = (index) => setRows((current) => current.filter((_, i) => i !== index))

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit({
      name,
      exercises: rows.map((row, index) => ({
        exerciseId: row.exercise.id,
        position: index + 1,
        targetSets: Number(row.targetSets),
        targetReps: Number(row.targetReps),
        targetWeight: row.targetWeight === '' ? null : Number(row.targetWeight),
        restSeconds: Number(row.restSeconds),
        notes: row.notes.trim(),
      })),
    })
  }

  return (
    <Stack component="form" onSubmit={handleSubmit} spacing={3}>
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
          options={catalogue}
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
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>
                      {row.exercise.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {row.exercise.muscle_group}
                    </Typography>
                  </Box>

                  <IconButton
                    onClick={() => removeRow(index)}
                    aria-label={`Remove ${row.exercise.name}`}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
                    gap: 1.5,
                    mt: 2,
                  }}
                >
                  <TextField
                    label="Sets"
                    type="number"
                    value={row.targetSets}
                    onChange={(event) => updateRow(index, 'targetSets', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 20 } }}
                    required
                  />
                  <TextField
                    label="Reps"
                    type="number"
                    value={row.targetReps}
                    onChange={(event) => updateRow(index, 'targetReps', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 100 } }}
                    required
                  />
                  <TextField
                    label="Weight (kg)"
                    type="number"
                    value={row.targetWeight}
                    onChange={(event) => updateRow(index, 'targetWeight', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'decimal', min: 0, max: 999, step: 0.5 } }}
                    placeholder="Optional"
                  />
                  <TextField
                    label="Rest (sec)"
                    type="number"
                    value={row.restSeconds}
                    onChange={(event) => updateRow(index, 'restSeconds', event.target.value)}
                    slotProps={{ htmlInput: { inputMode: 'numeric', min: 0, max: 600, step: 15 } }}
                    required
                  />
                </Box>
                <TextField
                  label="Technique note"
                  value={row.notes}
                  onChange={(event) => updateRow(index, 'notes', event.target.value)}
                  placeholder="Optional cues for the client"
                  multiline
                  minRows={2}
                  fullWidth
                  sx={{ mt: 1.5 }}
                />
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {/* Offline the mutation pauses: `onSuccess` never runs, no error is
          raised, and the button would sit on "Saving…" forever with nothing to
          explain it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. This session is saved on your device and will be added to the plan when
          you reconnect.
        </Alert>
      ) : null}

      {/* Without this the button simply returns to its idle label and the write
          is believed to have landed. */}
      {error ? (
        <Alert severity="error">
          {error.message ?? 'The session could not be saved. Try again.'}
        </Alert>
      ) : null}

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={rows.length === 0 || pending}
      >
        {paused ? 'Saved offline' : pending ? 'Saving…' : submitLabel}
      </Button>
    </Stack>
  )
}
