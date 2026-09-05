import { useState } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchMemberAppointmentsInRange } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatDate, localDayISO, todayISO } from '../../lib/format.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import AppointmentCard from '../../components/AppointmentCard.jsx'
import PageHeader from '../../components/PageHeader.jsx'

/** `'YYYY-MM-DD'` a whole number of days from today, in the local calendar. */
function dayOffsetISO(days) {
  const now = new Date()
  return localDayISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
}

/**
 * Every appointment a professional has with one client.
 *
 * The member has had this view of their trainer since Phase 4A; the coach had
 * no equivalent, and no route to reach one -- their only appointment screen was
 * the calendar, which shows one day at a time across every client at once and
 * cannot be filtered. The data was already there:
 * `fetchMemberAppointmentsInRange` needed no new query.
 *
 * Split at today rather than listed flat, because the two halves are read for
 * different reasons: what is coming is a plan, what has been is a record.
 */
export default function ClientAppointmentsScreen() {
  const { clientId } = useParams()
  const today = todayISO()
  // Fixed at mount, so a screen left open overnight does not silently refetch
  // under a different key.
  const [range] = useState(() => ({ from: dayOffsetISO(-90), to: dayOffsetISO(180) }))

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const appointments = useQuery({
    queryKey: queryKeys.memberAppointments(clientId, range.from, range.to),
    queryFn: () => fetchMemberAppointmentsInRange(clientId, range.from, range.to),
  })

  if (client.isPending) return <LoadingState />
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const all = appointments.data ?? []
  const dayOf = (appointment) => localDayISO(appointment.starts_at)
  const upcoming = all.filter((appointment) => dayOf(appointment) >= today)
  // Newest first: the most recent session is the one a coach looks back at.
  const past = all.filter((appointment) => dayOf(appointment) < today).reverse()

  const section = (title, items, emptyDescription) => (
    <Box>
      <Typography variant="h2" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {items.length === 0 ? (
        <EmptyState title="Nothing here" description={emptyDescription} minHeight={0} padding={2} />
      ) : (
        <Stack spacing={2}>
          {items.map((appointment) => (
            <Box key={appointment.id}>
              <Typography variant="overline" color="text.secondary" component="p">
                {formatDate(dayOf(appointment))}
              </Typography>
              {/* The client, not `appointment.pro`. This query embeds the
                  professional, because it was written for the member's own
                  screen -- passing it here showed the coach their own name and
                  face on every card of a screen about someone else. */}
              <AppointmentCard
                appointment={appointment}
                person={client.data}
                to={`/p/calendar/${appointment.id}`}
              />
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title="Appointments"
        subtitle={client.data.full_name}
        backTo={`/p/clients/${clientId}`}
        backLabel={`Back to ${client.data.full_name}`}
      />

      {appointments.isPending ? <LoadingState /> : null}
      {/* Gated on `data === undefined`, never on `isError` alone: with
          `offlineFirst` a failed refetch leaves the cached list in place, and
          an error screen over a usable answer is the wrong call. */}
      {appointments.isError && appointments.data === undefined ? (
        <ErrorState error={appointments.error} onRetry={appointments.refetch} />
      ) : null}

      {appointments.data ? (
        <>
          {section('Upcoming', upcoming, 'Nothing is booked with this client yet.')}
          {section('Past', past, 'No sessions have taken place yet.')}
        </>
      ) : null}
    </Stack>
  )
}
