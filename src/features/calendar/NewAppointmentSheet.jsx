import { useEffect, useState } from 'react'
import {
  Alert, Button, Drawer, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchClients } from '../../data/clients.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { slotToISO, todayISO } from '../../lib/format.js'
import { createUuid } from '../../lib/uuid.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

const KINDS = [
  { value: 'training', label: 'Personal Training' },
  { value: 'protocol', label: 'Protocol Consultation' },
  { value: 'nutrition', label: 'Nutrition Consultation' },
]

const DURATIONS = [30, 45, 60, 90, 120]

export default function NewAppointmentSheet({ open, onClose, defaultDayISO }) {
  const { user } = useAuth()

  const [memberId, setMemberId] = useState('')
  const [kind, setKind] = useState('training')
  const [day, setDay] = useState(defaultDayISO)
  const [time, setTime] = useState('09:00')
  const [minutes, setMinutes] = useState(60)
  const [notes, setNotes] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [open])

  const clients = useQuery({
    queryKey: queryKeys.clients(user.id),
    queryFn: () => fetchClients(user.id),
    // Nothing to book while the sheet is shut.
    enabled: open,
  })

  const create = useMutation({ mutationKey: mutationKeys.createAppointment })
  const savedOffline = create.isPending && create.isPaused
  const selectedStart = slotToISO(day, time, Number(minutes)).startsAt
  const isPast = day < todayISO() || new Date(selectedStart).getTime() <= now

  const onSubmit = (event) => {
    event.preventDefault()
    const { startsAt, endsAt } = slotToISO(day, time, Number(minutes))

    // A long-open form must not turn a formerly future slot into a past
    // appointment. The disabled state is helpful UI; this is the final guard.
    if (new Date(startsAt).getTime() <= Date.now()) return

    create.mutate(
      {
        // Generated here, not by the database: this write can pause offline and
        // replay on reconnect, and the id is what makes the replay a no-op
        // instead of a second booking.
        id: createUuid(),
        memberId,
        proId: user.id,
        kind,
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
          'aria-labelledby': 'new-appointment-title',
          sx: { borderTopLeftRadius: 24, borderTopRightRadius: 24, p: 2 },
        },
      }}
    >
      <Stack component="form" spacing={2} onSubmit={onSubmit}>
        <Typography id="new-appointment-title" variant="h2">
          New appointment
        </Typography>

        {clients.isPending ? <LoadingState /> : null}
        {clients.isError && clients.data === undefined ? (
          <ErrorState error={clients.error} onRetry={clients.refetch} />
        ) : null}
        {clients.data?.length === 0 ? (
          <Alert severity="info">
            No clients are assigned to you yet. Add an appointment after a client is assigned.
          </Alert>
        ) : null}

        {clients.data ? (
          <TextField
            select
            label="Client"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            required
            fullWidth
          >
            {clients.data.map((client) => (
              <MenuItem key={client.id} value={client.id}>
                {client.full_name}
              </MenuItem>
            ))}
          </TextField>
        ) : null}

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

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          {/* Native date and time inputs: the platform already ships a correct,
              accessible, locale-aware picker on every device this runs on. */}
          <TextField
            label="Date"
            type="date"
            value={day}
            onChange={(event) => setDay(event.target.value)}
            required
            sx={{ flexGrow: 1 }}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: todayISO() } }}
          />
          <TextField
            label="Start"
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
            sx={{ width: { xs: '100%', sm: 130 } }}
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
          multiline
          minRows={2}
          fullWidth
        />

        {isPast ? <Alert severity="warning">Choose a future date and time.</Alert> : null}

        {savedOffline ? (
          <Alert severity="info">
            You are offline. This booking is saved on your device and will sync when you reconnect.
          </Alert>
        ) : null}
        {create.isError ? (
          <Alert severity="error">
            {create.error?.message ?? 'The appointment could not be booked.'}
          </Alert>
        ) : null}

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={!memberId || create.isPending || isPast}
        >
          {savedOffline ? 'Saved offline' : create.isPending ? 'Booking…' : 'Book appointment'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </Stack>
    </Drawer>
  )
}
