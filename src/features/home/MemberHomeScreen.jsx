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

  // Three different nothings, and telling a member "every session is done" when
  // their trainer has not written any is the worst of them.
  const emptyPlanCopy =
    plan.data == null
      ? {
          title: 'No plan yet',
          description: 'Your trainer has not assigned you a workout plan yet.',
        }
      : sessions.length === 0
        ? {
            title: 'Plan not ready',
            description: 'Your trainer has created your plan but has not added any sessions yet.',
          }
        : {
            title: 'Plan complete',
            description: 'Every session in your plan is done. Nice work.',
          }

  return (
    <Stack spacing={4} sx={{ p: 2 }}>
      <Box>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 2 }}>
          <Typography variant="h1">Today</Typography>
          {/* No count until there is one.  "0 activities" above a spinner states
              something the screen does not know yet. */}
          {appointments.data ? (
            <Typography variant="h3" component="span" color="text.secondary">
              • {appointments.data.length} activities
            </Typography>
          ) : null}
        </Stack>

        {appointments.isPending ? <LoadingState /> : null}

        {/* Only when there is nothing to fall back on.  With `offlineFirst` a
            refetch can fail while the persisted cache still holds a good answer,
            and an error banner above usable data reads as "your app is broken"
            when the truth is "you are offline" -- the state this app is built
            to keep working in. */}
        {appointments.isError && appointments.data === undefined ? (
          <ErrorState error={appointments.error} onRetry={appointments.refetch} />
        ) : null}

        {appointments.data?.length === 0 ? (
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
        <Typography variant="h1" component="h2" sx={{ mb: 2 }}>
          Workout
        </Typography>

        {plan.isPending ? <LoadingState /> : null}

        {plan.isError && plan.data === undefined ? (
          <ErrorState error={plan.error} onRetry={plan.refetch} />
        ) : null}

        {/* `undefined` means the plan has not loaded; `null` means it loaded and
            there is none.  Collapsing the two would show "No plan yet" to every
            member for the length of the first fetch. */}
        {plan.data !== undefined && !current ? (
          <EmptyState
            title={emptyPlanCopy.title}
            description={emptyPlanCopy.description}
          />
        ) : null}

        {current ? (
          <SessionCard session={current} to={`/m/workout/session/${current.id}`} />
        ) : null}
      </Box>
    </Stack>
  )
}
