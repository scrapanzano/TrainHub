import { Box, Fab, Stack, Typography } from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchAgendaOnDay } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function ProfessionalHomeScreen() {
  const { user } = useAuth()
  const day = todayISO()

  const agenda = useQuery({
    queryKey: queryKeys.agendaOnDay(user.id, day),
    queryFn: () => fetchAgendaOnDay(user.id, day),
  })

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h1">Today</Typography>
          {/* No count until there is one: "0 activities" above a spinner states
              something the screen does not know yet. */}
          {agenda.data ? (
            <Typography variant="h3" component="span" color="text.secondary" noWrap>
              • {agenda.data.length} activities
            </Typography>
          ) : null}
        </Stack>

        <Fab
          component={Link}
          to="/p/calendar?new=1"
          color="primary"
          size="small"
          aria-label="New appointment"
        >
          <AddIcon />
        </Fab>
      </Stack>

      {agenda.isPending ? <LoadingState /> : null}

      {/* Only when there is nothing to fall back on.  With `offlineFirst` a
          failed refetch leaves the persisted answer in place, and an error
          banner above a usable agenda reads as "the app is broken" when the
          truth is "you are offline". */}
      {agenda.isError && agenda.data === undefined ? (
        <ErrorState error={agenda.error} onRetry={agenda.refetch} />
      ) : null}

      {agenda.data?.length === 0 ? (
        <EmptyState
          title="Nothing booked today"
          description="Sessions and consultations you have scheduled will appear here."
        />
      ) : null}

      <Stack spacing={2}>
        {(agenda.data ?? []).map((appointment) => (
          <AppointmentCard
            key={appointment.id}
            appointment={appointment}
            person={appointment.member}
            to={`/p/calendar/${appointment.id}`}
          />
        ))}
      </Stack>

      {/* The bottom nav is fixed; without this the last card sits under it. */}
      <Box sx={{ height: 8 }} />
    </Stack>
  )
}
