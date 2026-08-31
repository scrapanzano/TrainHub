import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchAvailability } from '../../data/availability.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

// Index is the stored `weekday`; Postgres puts Sunday at 0, and the column's
// own `between 0 and 6` check follows that.  Displayed Monday-first below, so
// the ordering matches the calendar without changing what is stored.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** `'09:00:00'` → `'09:00'`.  Postgres returns `time` with seconds. */
const hhmm = (value) => String(value).slice(0, 5)

export default function AvailabilityScreen() {
  const { user } = useAuth()

  const [weekday, setWeekday] = useState(1)
  const [startsAt, setStartsAt] = useState('09:00')
  const [endsAt, setEndsAt] = useState('13:00')

  const slots = useQuery({
    queryKey: queryKeys.availability(user.id),
    queryFn: () => fetchAvailability(user.id),
  })

  const add = useMutation({ mutationKey: mutationKeys.addAvailability })
  const remove = useMutation({ mutationKey: mutationKeys.deleteAvailability })

  const savedOffline = add.isPending && add.isPaused
  const removalSavedOffline = remove.isPending && remove.isPaused
  // The database rejects this too, but telling the user before the round trip
  // is better than an error message from Postgres.  String comparison is
  // correct here (not just for the common case) because `<input type="time">`
  // guarantees zero-padded 24-hour `'HH:MM'` values, which sort the same
  // lexicographically as they do chronologically.
  const invalidRange = endsAt <= startsAt
  const overlapsExisting = (slots.data ?? []).some(
    (slot) => slot.weekday === Number(weekday)
      && startsAt < hhmm(slot.ends_at)
      && endsAt > hhmm(slot.starts_at),
  )

  if (slots.isPending) return <LoadingState />
  if (slots.isError && slots.data === undefined) {
    return <ErrorState error={slots.error} onRetry={slots.refetch} />
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">Availability</Typography>
        <Typography color="text.secondary">
          The hours you are bookable each week. Members see these when they request a session.
        </Typography>
      </Stack>

      {slots.data.length === 0 ? (
        <EmptyState
          title="No hours set"
          description="Add your first weekly slot below. Until then nobody can request a session."
        />
      ) : null}

      <Stack spacing={2}>
        {DISPLAY_ORDER.map((dayIndex) => {
          const daySlots = slots.data.filter((slot) => slot.weekday === dayIndex)
          if (daySlots.length === 0) return null

          return (
            <Card key={dayIndex}>
              <CardContent>
                <Typography variant="h3" sx={{ mb: 1 }}>
                  {DAY_NAMES[dayIndex]}
                </Typography>

                <Stack spacing={1}>
                  {daySlots.map((slot) => (
                    <Stack key={slot.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Typography sx={{ flexGrow: 1 }}>
                        {hhmm(slot.starts_at)} – {hhmm(slot.ends_at)}
                      </Typography>
                      <IconButton
                        aria-label={`Remove ${DAY_NAMES[dayIndex]} ${hhmm(slot.starts_at)} to ${hhmm(slot.ends_at)}`}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate({ availabilityId: slot.id })}
                      >
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Stack>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )
        })}
      </Stack>

      {remove.isError ? (
        <Alert severity="error">{remove.error?.message ?? 'The slot could not be removed.'}</Alert>
      ) : null}
      {removalSavedOffline ? (
        <Alert severity="info">
          The selected slot will be removed when you reconnect.
        </Alert>
      ) : null}

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Add a slot
        </Typography>

        <Card>
          <CardContent>
            <Stack
              component="form"
              spacing={2}
              onSubmit={(event) => {
                event.preventDefault()
                // No `onSuccess` reset here on purpose: the form keeps its
                // values after a save so a professional can add several slots
                // to the same day in a row without re-picking the day and
                // times each time. (A previous version set `weekday` back to
                // the value it already held -- a no-op dressed as a reset.)
                add.mutate({
                  id: createUuid(),
                  proId: user.id,
                  weekday: Number(weekday),
                  startsAt,
                  endsAt,
                })
              }}
            >
              <TextField
                select
                label="Day"
                value={weekday}
                onChange={(event) => setWeekday(Number(event.target.value))}
                fullWidth
              >
                {DISPLAY_ORDER.map((dayIndex) => (
                  <MenuItem key={dayIndex} value={dayIndex}>
                    {DAY_NAMES[dayIndex]}
                  </MenuItem>
                ))}
              </TextField>

              <Stack direction="row" spacing={1}>
                <TextField
                  label="From"
                  type="time"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                  required
                  sx={{ flexGrow: 1 }}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="To"
                  type="time"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                  required
                  error={invalidRange}
                  helperText={invalidRange ? 'Must be after the start time' : ' '}
                  sx={{ flexGrow: 1 }}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Stack>

              {savedOffline ? (
                <Alert severity="info">
                  You are offline. This slot is saved on your device and will sync when you
                  reconnect.
                </Alert>
              ) : null}
              {overlapsExisting ? (
                <Alert severity="warning">
                  This slot overlaps another availability on the same day.
                </Alert>
              ) : null}
              {add.isError ? (
                <Alert severity="error">
                  {add.error?.message ?? 'The slot could not be added.'}
                </Alert>
              ) : null}

              <Button
                type="submit"
                variant="contained"
                startIcon={<AddIcon />}
                disabled={invalidRange || overlapsExisting || add.isPending}
                fullWidth
              >
                {savedOffline ? 'Saved offline' : add.isPending ? 'Adding…' : 'Add slot'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  )
}
