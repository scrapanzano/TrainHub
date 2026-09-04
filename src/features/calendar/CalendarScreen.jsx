import { useState } from 'react'
import {
  Box, Card, CardActionArea, CardContent, IconButton, Stack, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ScheduleIcon from '@mui/icons-material/Schedule'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { fetchAppointmentsInRange } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatDate, localDayISO, todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import MonthGrid from '../../components/MonthGrid.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import NewAppointmentSheet from './NewAppointmentSheet.jsx'
import { monthGrid, monthLabel, shiftMonth } from './month.js'

export default function CalendarScreen() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [selected, setSelected] = useState(todayISO())

  // The visible month follows the selected day, so tapping a padding cell moves
  // the grid to the month that day belongs to without any extra state.
  const [year, month] = selected.split('-').map(Number)
  const cells = monthGrid(year, month)

  // The grid is always whole weeks, so its ends bound every day either view can
  // show -- including a week strip that straddles a month boundary.  One query
  // therefore serves the dots and the day's list in both views.
  const rangeFrom = cells[0].dateISO
  const rangeTo = cells.at(-1).dateISO

  const appointments = useQuery({
    queryKey: queryKeys.agendaRange(user.id, rangeFrom, rangeTo),
    queryFn: () => fetchAppointmentsInRange(user.id, rangeFrom, rangeTo),
  })

  // One marker colour per day: the first appointment's kind.  A day can hold
  // several kinds, and a 5px dot cannot say so -- the list below can.
  const markers = {}
  for (const appointment of appointments.data ?? []) {
    const dayISO = localDayISO(appointment.starts_at)
    if (!markers[dayISO]) markers[dayISO] = appointment.kind
  }

  const onDay = (appointments.data ?? []).filter(
    (appointment) => localDayISO(appointment.starts_at) === selected,
  )

  const step = (delta) => {
    const next = shiftMonth(year, month, delta)
    const lastDay = monthGrid(next.year, next.month).filter((cell) => cell.inMonth).at(-1)
    const [, , day] = selected.split('-').map(Number)
    // Keep the day of the month where it exists, and clamp where it does not --
    // stepping back from 31 March must land on 28 February, not 3 March.
    const target = Math.min(day, lastDay.day)
    setSelected(`${next.year}-${String(next.month).padStart(2, '0')}-${String(target).padStart(2, '0')}`)
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={{ xs: 0.5, sm: 1 }}
        sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          <Typography variant="h1" sx={{ minWidth: 0 }} noWrap>
            {monthLabel(year, month)}
          </Typography>

          {/* Grouped with the month controls: this opens weekly availability
              settings, it does not book anything. */}
          <IconButton component={Link} to="/p/calendar/availability" aria-label="Weekly availability">
            <ScheduleIcon color="primary" />
          </IconButton>
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
          <IconButton onClick={() => step(-1)} aria-label="Previous month">
            <ChevronLeftIcon color="primary" />
          </IconButton>
          <IconButton onClick={() => step(1)} aria-label="Next month">
            <ChevronRightIcon color="primary" />
          </IconButton>
        </Stack>
      </Stack>

      {/* Always the whole month. The wireframes gave the calendar a
          collapsed/expanded pair of states and it opened collapsed, so the
          screen whose job is showing a month opened showing a week -- and the
          choice was component-local, so it reset on every navigation back
          here. */}
      <MonthGrid cells={cells} selected={selected} onSelect={setSelected} markers={markers} />

      <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
        <Typography variant="h2">{selected === todayISO() ? 'Today' : formatDate(selected)}</Typography>
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
          <AppointmentCard
            key={appointment.id}
            appointment={appointment}
            person={appointment.member}
            to={`/p/calendar/${appointment.id}`}
          />
        ))}
      </Stack>

      {/* The same affordance the member gets, rather than a small `Fab` tucked
          between the month arrows. Booking is the one thing this screen exists
          to start, and it was the least visible control on it -- while the
          member's side offered a full-width card that says what it books. */}
      {selected >= todayISO() ? (
        <Card sx={{ borderColor: 'primary.main' }}>
          <CardActionArea onClick={() => setSearchParams({ new: '1' })}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <AddIcon color="primary" />
                <Stack>
                  <Typography variant="h3">Book for this day</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Training or consultation
                  </Typography>
                </Stack>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ) : null}

      {/* A new form instance takes the current selected day as its initial
          value and cannot retain fields from an earlier booking. */}
      {searchParams.get('new') === '1' ? (
        <NewAppointmentSheet
          open
          // `replace` so closing the sheet does not leave a history entry that
          // Back would use to reopen it.
          onClose={() => setSearchParams({}, { replace: true })}
          defaultDayISO={selected}
        />
      ) : null}
    </Stack>
  )
}
