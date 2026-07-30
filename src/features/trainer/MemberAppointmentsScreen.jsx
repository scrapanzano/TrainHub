import { useState } from 'react'
import { Box, Card, CardActionArea, CardContent, IconButton, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { fetchMemberAppointmentsInRange } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatDate, localDayISO, todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import MonthGrid from '../../components/MonthGrid.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import { monthGrid, monthLabel, shiftMonth } from '../calendar/month.js'
import BookingSheet from './BookingSheet.jsx'

export default function MemberAppointmentsScreen() {
  const { user, profile } = useAuth()
  const [selected, setSelected] = useState(todayISO())
  const [booking, setBooking] = useState(false)

  // The visible month follows the selected day, so tapping a padding cell moves
  // the grid to the month that day belongs to without any extra state.
  const [year, month] = selected.split('-').map(Number)
  const cells = monthGrid(year, month)
  const rangeFrom = cells[0].dateISO
  const rangeTo = cells.at(-1).dateISO

  const appointments = useQuery({
    queryKey: queryKeys.memberAppointments(user.id, rangeFrom, rangeTo),
    queryFn: () => fetchMemberAppointmentsInRange(user.id, rangeFrom, rangeTo),
  })

  // `localDayISO`, not `toISOString().slice(0, 10)`: the latter gives the UTC
  // day and puts a late-evening appointment on the wrong date east of
  // Greenwich. It is self-checked; an inline equivalent here would not be.
  const dayOf = (appointment) => localDayISO(appointment.starts_at)

  const markers = {}
  for (const appointment of appointments.data ?? []) {
    const key = dayOf(appointment)
    if (!markers[key]) markers[key] = appointment.kind
  }

  const onDay = (appointments.data ?? []).filter((a) => dayOf(a) === selected)

  const step = (delta) => {
    const next = shiftMonth(year, month, delta)
    const lastDay = monthGrid(next.year, next.month).filter((cell) => cell.inMonth).at(-1)
    const [, , day] = selected.split('-').map(Number)
    // Keep the day of the month where it exists and clamp where it does not:
    // stepping back from 31 March must land on 28 February, not 3 March.
    const target = Math.min(day, lastDay.day)
    setSelected(
      `${next.year}-${String(next.month).padStart(2, '0')}-${String(target).padStart(2, '0')}`,
    )
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="h1" sx={{ minWidth: 0 }} noWrap>
          {monthLabel(year, month)}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton onClick={() => step(-1)} aria-label="Previous month">
          <ChevronLeftIcon color="primary" />
        </IconButton>
        <IconButton onClick={() => step(1)} aria-label="Next month">
          <ChevronRightIcon color="primary" />
        </IconButton>
      </Stack>

      <MonthGrid cells={cells} selected={selected} onSelect={setSelected} markers={markers} />

      <Stack direction="row" spacing={1} alignItems="baseline">
        <Typography variant="h2">
          {selected === todayISO() ? 'Today' : formatDate(selected)}
        </Typography>
        {appointments.data ? (
          <Typography variant="h3" component="span" color="text.secondary">
            • {onDay.length} activities
          </Typography>
        ) : null}
      </Stack>

      {appointments.isPending ? <LoadingState /> : null}
      {appointments.isError && appointments.data === undefined ? (
        <ErrorState error={appointments.error} onRetry={appointments.refetch} />
      ) : null}
      {appointments.data && onDay.length === 0 ? (
        <EmptyState title="Nothing booked" description="This day is free." />
      ) : null}

      <Stack spacing={2}>
        {onDay.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} person={appointment.pro} />
        ))}
      </Stack>

      {/* A member with no professional has nobody to book with. Say so rather
          than opening a form whose write the database would reject. */}
      {profile?.assigned_pro_id ? (
        <Card sx={{ borderColor: 'primary.main' }}>
          <CardActionArea onClick={() => setBooking(true)}>
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <AddIcon color="primary" />
                <Stack>
                  <Typography variant="h3">Book for this day</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Workout or consultation
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ) : (
        <EmptyState
          title="No professional yet"
          description="Choose one from the Trainer tab before booking."
        />
      )}

      <BookingSheet
        open={booking}
        onClose={() => setBooking(false)}
        defaultDayISO={selected}
      />
    </Stack>
  )
}
