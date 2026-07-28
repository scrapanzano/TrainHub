import { useState } from 'react'
import { Box, Button, Drawer, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { setProgress } from './status.js'
import { useAuth } from '../auth/useAuth.js'

export default function LogSetSheet({ open, onClose, exercise, sessionId }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const progress = setProgress(exercise?.loggedCount, exercise?.target_sets)
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')

  const logSet = useMutation({
    // No `mutationFn` here on purpose: it is registered against this key in
    // `src/data/mutations.js`, which is also where a mutation restored from
    // IndexedDB after a reload finds it again.  Declaring it here too would
    // create a second source of truth that the persister cannot see.
    mutationKey: mutationKeys.logSet,

    onMutate: async (variables) => {
      // Offline this mutation pauses and settles minutes later.  Writing the
      // new count now is what makes the "2/3" pill move the moment the button
      // is tapped -- otherwise nothing happens and the set gets logged twice.
      await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })
      const previous = queryClient.getQueryData(queryKeys.session(sessionId))

      queryClient.setQueryData(queryKeys.session(sessionId), (current) =>
        current
          ? {
              ...current,
              exercises: current.exercises.map((item) =>
                item.id === variables.sessionExerciseId
                  ? { ...item, loggedCount: item.loggedCount + 1 }
                  : item,
              ),
            }
          : current,
      )

      return { previous }
    },

    onError: (_error, _variables, context) => {
      // Put the count back only if we have something to put back.
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.session(sessionId), context.previous)
      }
    },
  })

  const onSubmit = (event) => {
    event.preventDefault()

    logSet.mutate({
      // The client owns this id so a replayed write upserts instead of
      // duplicating.  `crypto.randomUUID` needs a secure context: HTTPS or
      // localhost, which is every way this app is served.
      id: crypto.randomUUID(),
      sessionExerciseId: exercise.id,
      sessionId,
      memberId: user.id,
      setNumber: progress.done + 1,
      reps: Number(reps),
      weight: weight === '' ? null : Number(weight),
      // Stamped here, not by the database default.  This write may sit paused
      // for hours and be replayed on reconnect; `now()` at insert time would
      // record a set performed at 18:00 as happening at 23:00.
      performedAt: new Date().toISOString(),
    })

    setReps('')
    setWeight('')
    onClose()
  }

  if (!exercise) return null

  return (
    <Drawer anchor="bottom" open={open} onClose={onClose}>
      <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ p: 3 }}>
        <Box>
          <Typography variant="h2" component="h2">
            {exercise.exercise.name}
          </Typography>
          <Typography color="text.secondary">
            Set {progress.done + 1} of {exercise.target_sets} • target {exercise.target_reps} reps
          </Typography>
        </Box>

        <Stack direction="row" spacing={2}>
          <TextField
            label="Reps"
            type="number"
            value={reps}
            onChange={(event) => setReps(event.target.value)}
            // `inputMode` is what actually summons the numeric keypad on a
            // phone; type="number" alone gives a full keyboard on some Androids.
            slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 999 } }}
            placeholder={String(exercise.target_reps)}
            required
            fullWidth
            autoFocus
          />
          <TextField
            label="Weight (kg)"
            type="number"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            slotProps={{ htmlInput: { inputMode: 'decimal', step: 0.5, min: 0, max: 999 } }}
            placeholder={exercise.target_weight ? String(exercise.target_weight) : 'Bodyweight'}
            fullWidth
          />
        </Stack>

        <Button type="submit" variant="contained" size="large" fullWidth>
          Log set
        </Button>
      </Stack>
    </Drawer>
  )
}
