import { Alert, Avatar, Button, Card, CardContent, Chip, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchAppointment } from '../../data/appointments.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { formatTimeRange } from '../../lib/format.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'

const KIND_LABEL = {
  training: 'Personal Training',
  protocol: 'Protocol Consultation',
  nutrition: 'Nutrition Consultation',
}

const STATUS_LABEL = {
  pending: 'Not confirmed yet',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  done: 'Completed',
}

export default function AppointmentDetailScreen() {
  const { appointmentId } = useParams()

  const appointment = useQuery({
    queryKey: queryKeys.appointment(appointmentId),
    queryFn: () => fetchAppointment(appointmentId),
  })

  const setStatus = useMutation({ mutationKey: mutationKeys.setAppointmentStatus })

  if (appointment.isPending) return <LoadingState />
  if (appointment.isError && appointment.data === undefined) {
    return <ErrorState error={appointment.error} onRetry={appointment.refetch} />
  }

  const row = appointment.data
  const move = (status) => setStatus.mutate({
    appointmentId,
    expectedStatus: row.status,
    status,
  })
  const savedOffline = setStatus.isPending && setStatus.isPaused

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={1}>
        <PageHeader
          title={KIND_LABEL[row.kind] ?? 'Appointment'}
          subtitle={`${new Date(row.starts_at).toLocaleDateString(undefined, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          })} • ${formatTimeRange(row.starts_at, row.ends_at)}`}
          backTo="/p/calendar"
          backLabel="Back to calendar"
        />
        <Stack direction="row">
          <Chip
            size="small"
            label={STATUS_LABEL[row.status] ?? row.status}
            color={
              row.status === 'cancelled'
                ? 'error'
                : row.status === 'done' || row.status === 'confirmed'
                  ? 'success'
                  : 'warning'
            }
          />
        </Stack>
      </Stack>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Avatar src={row.member?.avatar_url ?? undefined} sx={{ width: 48, height: 48 }}>
              {row.member?.full_name?.[0] ?? '?'}
            </Avatar>
            <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h3" noWrap>
                {row.member?.full_name ?? 'Unknown client'}
              </Typography>
              {row.member ? (
                <Typography
                  variant="body2"
                  color="primary"
                  component={Link}
                  to={`/p/clients/${row.member.id}`}
                >
                  Open client profile
                </Typography>
              ) : null}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {row.notes ? (
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 1 }}>
              Notes
            </Typography>
            <Typography>{row.notes}</Typography>
          </CardContent>
        </Card>
      ) : null}

      {savedOffline ? (
        <Alert severity="info">
          You are offline. This change is saved on your device and will sync when you reconnect.
        </Alert>
      ) : null}
      {setStatus.isError ? (
        <Alert severity="error">
          {setStatus.error?.message ?? 'The appointment could not be updated.'}
        </Alert>
      ) : null}

      <Stack spacing={1}>
        {/* Only offer the moves that make sense from here.  A cancelled
            appointment marked "done" is a contradiction the enum permits and
            the UI should not. */}
        {row.status === 'pending' ? (
          <Button variant="contained" disabled={setStatus.isPending} onClick={() => move('confirmed')}>
            Confirm
          </Button>
        ) : null}

        {row.status === 'confirmed' ? (
          <Button variant="contained" disabled={setStatus.isPending} onClick={() => move('done')}>
            Mark as completed
          </Button>
        ) : null}

        {row.status === 'pending' || row.status === 'confirmed' ? (
          <Button color="error" disabled={setStatus.isPending} onClick={() => move('cancelled')}>
            Cancel appointment
          </Button>
        ) : null}

        {row.status === 'cancelled' ? (
          <Button disabled={setStatus.isPending} onClick={() => move('confirmed')}>
            Reinstate
          </Button>
        ) : null}
      </Stack>
    </Stack>
  )
}
