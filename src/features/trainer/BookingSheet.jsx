import { useState } from 'react'
import { Alert, Button, Drawer, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { slotToISO } from '../../lib/format.js'
import { useAuth } from '../auth/useAuth.js'

const KINDS = [
  { value: 'training', label: 'Personal Training' },
  { value: 'protocol', label: 'Protocol Consultation' },
  { value: 'nutrition', label: 'Nutrition Consultation' },
]

const DURATIONS = [30, 45, 60, 90, 120]

export default function BookingSheet({ open, onClose, defaultDayISO }) {
  const { user, profile } = useAuth()

  const [kind, setKind] = useState('training')
  const [day, setDay] = useState(defaultDayISO)
  const [time, setTime] = useState('09:00')
  const [minutes, setMinutes] = useState(60)
  const [notes, setNotes] = useState('')

  // The sheet is rendered whether open or not -- only the Drawer's `open`
  // toggles visibility -- so it never unmounts and useState's initialiser runs
  // exactly once. Without this reset the date silently keeps whatever day was
  // selected on first mount, and the form keeps the previous booking's values.
  // Compared during render rather than in an effect: on the render where `open`
  // flips, an effect fires in the same commit with stale state.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setKind('training')
      setDay(defaultDayISO)
      setTime('09:00')
      setMinutes(60)
      setNotes('')
    }
  }

  const create = useMutation({ mutationKey: mutationKeys.createAppointment })
  const savedOffline = create.isPending && create.isPaused

  const onSubmit = (event) => {
    event.preventDefault()
    const { startsAt, endsAt } = slotToISO(day, time, Number(minutes))

    create.mutate(
      {
        // Generated in the handler, not during render: this write can pause
        // offline and replay, and the id is what makes the replay a no-op
        // instead of a second booking.
        id: crypto.randomUUID(),
        memberId: user.id,
        proId: profile.assigned_pro_id,
        kind,
        // A member requests; the professional confirms. The professional's own
        // sheet books straight to 'confirmed' because they own the diary.
        status: 'pending',
        startsAt,
        endsAt,
        notes,
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-labelledby': 'new-booking-title',
          sx: { borderTopLeftRadius: 24, borderTopRightRadius: 24, p: 2 },
        },
      }}
    >
      <Stack component="form" spacing={2} onSubmit={onSubmit}>
        <Typography id="new-booking-title" variant="h2">
          New Booking
        </Typography>

        <TextField
          select
          label="Type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          fullWidth
        >
          {KINDS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction="row" spacing={1}>
          {/* Native date and time inputs: the platform already ships a correct,
              accessible, locale-aware picker on every device this runs on. */}
          <TextField
            label="Date"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            required
            sx={{ flexGrow: 1 }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Start"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
            sx={{ width: 130 }}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>

        <TextField
          select
          label="Duration"
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          fullWidth
        >
          {DURATIONS.map((option) => (
            <MenuItem key={option} value={option}>
              {option} minutes
            </MenuItem>
          ))}
        </TextField>

        <TextField
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Focus on core and mobility"
          multiline
          minRows={2}
          fullWidth
        />

        {savedOffline ? (
          <Alert severity="info">
            You are offline. This request is saved on your device and will be sent when you
            reconnect.
          </Alert>
        ) : null}
        {create.isError ? (
          <Alert severity="error">
            {create.error?.message ?? 'The appointment could not be requested.'}
          </Alert>
        ) : null}

        <Button type="submit" variant="contained" size="large" fullWidth disabled={create.isPending}>
          {savedOffline ? 'Saved offline' : create.isPending ? 'Requesting…' : 'Confirm booking'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </Stack>
    </Drawer>
  )
}
