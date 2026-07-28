import { Avatar, Box, Card, CardContent, Stack, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { formatTimeRange } from '../lib/format.js'

// The appointment_kind enum, mapped to the custom palette group in the theme.
const KIND_LABEL = {
  training: 'Personal Training',
  protocol: 'Protocol Consultation',
  nutrition: 'Nutrition Consultation',
}

export default function AppointmentCard({ appointment }) {
  const { kind, status, starts_at: startsAt, ends_at: endsAt, pro } = appointment
  const done = status === 'done'

  return (
    <Card
      sx={{
        // A finished appointment recedes; an upcoming one keeps its type colour.
        // Cancelled reads as finished on purpose -- neither needs attention.
        bgcolor: done || status === 'cancelled' ? 'task.done' : `task.${kind}`,
        border: 'none',
      }}
    >
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ color: 'text.primary', display: 'flex' }}>
            {done ? <CheckCircleIcon /> : <RadioButtonUncheckedIcon />}
          </Box>

          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {formatTimeRange(startsAt, endsAt)}
            </Typography>
            <Typography variant="h3" noWrap>
              {KIND_LABEL[kind] ?? 'Appointment'}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <Avatar src={pro?.avatar_url ?? undefined} sx={{ width: 20, height: 20 }}>
                {pro?.full_name?.[0] ?? '?'}
              </Avatar>
              <Typography variant="body2" color="text.secondary" noWrap>
                {pro?.full_name ?? 'Unassigned'}
              </Typography>
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
