import { Box, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { fetchAppointmentsOnDay } from '../../data/appointments.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import SessionCard from '../../components/SessionCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function MemberHomeScreen() {
  const { user } = useAuth()
  const memberId = user.id
  const day = todayISO()

  const appointments = useQuery({
    queryKey: queryKeys.appointmentsOnDay(memberId, day),
    queryFn: () => fetchAppointmentsOnDay(memberId, day),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(memberId),
    queryFn: () => fetchActivePlan(memberId),
  })

  // The header already greets by name, so this screen leads with the day's work.
  // Show whatever is under way; failing that, the next thing to do.
  const sessions = plan.data?.sessions ?? []
  const current =
    sessions.find((session) => session.status === 'in_progress') ??
    sessions.find((session) => session.status === 'todo')

  return (
    <Stack spacing={4} sx={{ p: 2 }}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 2 }}>
          <Typography variant="h1">Today</Typography>
          <Typography variant="h3" color="text.secondary">
            • {appointments.data?.length ?? 0} activities
          </Typography>
        </Stack>

        {appointments.isPending ? <LoadingState /> : null}
        {appointments.isError ? (
          <ErrorState error={appointments.error} onRetry={appointments.refetch} />
        ) : null}
        {appointments.isSuccess && appointments.data.length === 0 ? (
          <EmptyState
            title="Nothing booked today"
            description="Your appointments with your trainer will show up here."
          />
        ) : null}

        <Stack spacing={2}>
          {(appointments.data ?? []).map((appointment) => (
            <AppointmentCard key={appointment.id} appointment={appointment} />
          ))}
        </Stack>
      </Box>

      <Box>
        <Typography variant="h1" sx={{ mb: 2 }}>
          Workout
        </Typography>

        {plan.isPending ? <LoadingState /> : null}
        {plan.isError ? <ErrorState error={plan.error} onRetry={plan.refetch} /> : null}
        {plan.isSuccess && !current ? (
          <EmptyState
            title={plan.data ? 'Plan complete' : 'No plan yet'}
            description={
              plan.data
                ? 'Every session in your plan is done. Nice work.'
                : 'Your trainer has not assigned you a workout plan yet.'
            }
          />
        ) : null}

        {current ? (
          <SessionCard session={current} to={`/m/workout/session/${current.id}`} />
        ) : null}
      </Box>
    </Stack>
  )
}
