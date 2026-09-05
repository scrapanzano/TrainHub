import { useEffect, useState } from 'react'
import { Alert, Button, Drawer, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchAvailability } from '../../data/availability.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { slotToISO, todayISO } from '../../lib/format.js'
import { createUuid } from '../../lib/uuid.js'
import { isSubscriptionActive } from '../clients/subscription.js'
import { useAuth } from '../auth/useAuth.js'

const KINDS = [
  { value: 'training', label: 'Personal Training' },
  { value: 'protocol', label: 'Protocol Consultation' },
  { value: 'nutrition', label: 'Nutrition Consultation' },
]

const DURATIONS = [30, 45, 60, 90, 120]

const minutesOf = (hhmm) => {
  const [hours, minutes] = String(hhmm).slice(0, 5).split(':').map(Number)
  return hours * 60 + minutes
}

/**
 * A first offer the member does not have to correct.
 *
 * The sheet used to open on a hard-coded 09:00, so booking anything later the
 * same day showed "choose a future time" before the member had touched
 * anything -- the form accused them of a mistake they had not made yet.  On
 * today, start from the next half hour with a few minutes of slack for filling
 * the form in; on any other day 09:00 is as good a guess as exists before the
 * professional's availability has loaded.
 */
function defaultTimeFor(dayISO) {
  if (dayISO !== todayISO()) return '09:00'

  const soon = new Date(Date.now() + 10 * 60 * 1000)
  const half = soon.getMinutes() <= 30 ? 30 : 60
  soon.setMinutes(half, 0, 0)
  // Rolled past midnight. There is genuinely no bookable slot left today, so
  // offer the last one and let the sheet's own "choose a future time" warning
  // say so -- '09:00' would be a time fifteen hours gone, which is the very
  // thing this function exists to stop showing.
  if (soon.getDate() !== new Date().getDate()) return '23:30'
  return `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`
}

export default function BookingSheet({ open, onClose, defaultDayISO }) {
  const { user, profile } = useAuth()

  const [kind, setKind] = useState('training')
  const [day, setDay] = useState(defaultDayISO)
  // A lazy initialiser, because `react-hooks/purity` forbids reading the clock
  // in a render body.  The sheet is remounted on every opening, so this runs
  // afresh each time rather than going stale.
  const [time, setTime] = useState(() => defaultTimeFor(defaultDayISO))
  const [minutes, setMinutes] = useState(60)
  const [notes, setNotes] = useState('')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [open])

  const availability = useQuery({
    queryKey: queryKeys.availability(profile.assigned_pro_id),
    queryFn: () => fetchAvailability(profile.assigned_pro_id),
    enabled: open && Boolean(profile.assigned_pro_id),
  })

  const create = useMutation({ mutationKey: mutationKeys.createAppointment })
  const savedOffline = create.isPending && create.isPaused
  const [year, month, date] = day.split('-').map(Number)
  const weekday = new Date(year, month - 1, date).getDay()
  const startMinutes = minutesOf(time)
  const endMinutes = startMinutes + Number(minutes)
  const matchingSlot = (availability.data ?? []).some(
    (slot) => slot.weekday === weekday
      && startMinutes >= minutesOf(slot.starts_at)
      && endMinutes <= minutesOf(slot.ends_at),
  )
  const selectedStart = slotToISO(day, time, Number(minutes)).startsAt
  const isPast = day < todayISO() || new Date(selectedStart).getTime() <= now
  const unavailable = availability.data !== undefined && !matchingSlot
  const membershipInactive = !isSubscriptionActive(profile, todayISO())

  const onSubmit = (event) => {
    event.preventDefault()
    const { startsAt, endsAt } = slotToISO(day, time, Number(minutes))

    // The sheet can stay open across the selected start time. Re-check against
    // the real clock at submission instead of relying only on the render-time
    // warning, so an appointment can never be created in the past.
    if (new Date(startsAt).getTime() <= Date.now()) return
    if (membershipInactive) return

    create.mutate(
      {
        // Generated in the handler, not during render: this write can pause
        // offline and replay, and the id is what makes the replay a no-op
        // instead of a second booking.
        id: createUuid(),
        memberId: user.id,
        proId: profile.assigned_pro_id,
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
          'aria-labelledby': 'new-booking-title',
          sx: { borderTopLeftRadius: 24, borderTopRightRadius: 24, p: 2 },
        },
      }}
    >
      <Stack component="form" spacing={2} onSubmit={onSubmit}>
        <Typography id="new-booking-title" variant="h2">
          New Booking
        </Typography>

        {availability.isPending ? (
          <Alert severity="info">Loading the professional&rsquo;s available hours…</Alert>
        ) : null}
        {availability.isError && availability.data === undefined ? (
          <Alert severity="error">Available hours could not be loaded. Try again.</Alert>
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
          placeholder="Focus on core and mobility"
          multiline
          minRows={2}
          fullWidth
        />

        {membershipInactive ? (
          <Alert severity="warning">
            Your membership is not active. Ask your trainer to reactivate it before booking.
          </Alert>
        ) : isPast ? (
          <Alert severity="warning">Choose a future date and time.</Alert>
        ) : unavailable ? (
          <Alert severity="warning">
            This time is outside the professional&rsquo;s available hours. Choose another time.
          </Alert>
        ) : null}

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

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={
            create.isPending || availability.isPending || isPast || unavailable || membershipInactive
          }
        >
          {savedOffline ? 'Saved offline' : create.isPending ? 'Requesting…' : 'Confirm booking'}
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </Stack>
    </Drawer>
  )
}
