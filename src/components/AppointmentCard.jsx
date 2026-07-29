import { Avatar, Box, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import { Link } from 'react-router'
import { formatTimeRange } from '../lib/format.js'

// The appointment_kind enum, mapped to the custom palette group in the theme.
const KIND_LABEL = {
  training: 'Personal Training',
  protocol: 'Protocol Consultation',
  nutrition: 'Nutrition Consultation',
}

/**
 * One appointment row, colour-coded by kind.
 *
 * @param {object}   props
 * @param {object}   props.appointment The row.
 * @param {?object}  props.person      Whom to show: the professional on the
 *   member's screens, the member on the professional's.  The card does not
 *   choose, because the same row means a different counterpart to each side.
 * @param {?string}  props.to          Makes the whole card a link when given.
 */
export default function AppointmentCard({ appointment, person, to }) {
  const { kind, status, starts_at: startsAt, ends_at: endsAt } = appointment
  const done = status === 'done'
  const settled = done || status === 'cancelled'

  // The icon is the only thing carrying this state, and MUI hides an SvgIcon
  // from screen readers unless `titleAccess` gives it a name.  Without one, the
  // difference between a finished appointment and an upcoming one is visible
  // only to people who can see it.
  const statusLabel = {
    done: 'Completed',
    cancelled: 'Cancelled',
    confirmed: 'Confirmed',
    pending: 'Not confirmed yet',
  }[status] ?? 'Scheduled'

  const body = (
    <CardContent>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ color: 'text.primary', display: 'flex' }}>
          {done ? (
            <CheckCircleIcon titleAccess={statusLabel} />
          ) : (
            <RadioButtonUncheckedIcon titleAccess={statusLabel} />
          )}
        </Box>

        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary">
            {formatTimeRange(startsAt, endsAt)}
          </Typography>
          <Typography variant="h3" noWrap>
            {KIND_LABEL[kind] ?? 'Appointment'}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            <Avatar src={person?.avatar_url ?? undefined} sx={{ width: 20, height: 20 }}>
              {person?.full_name?.[0] ?? '?'}
            </Avatar>
            <Typography variant="body2" color="text.secondary" noWrap>
              {person?.full_name ?? 'Unassigned'}
            </Typography>
          </Stack>
        </Box>
      </Stack>
    </CardContent>
  )

  return (
    <Card
      sx={{
        // A settled appointment recedes; an upcoming one keeps its type colour.
        // Cancelled greys out alongside done because neither needs attention --
        // but only `done` earns the tick, and the label says which is which.
        bgcolor: settled ? 'task.done' : `task.${kind}`,
        border: 'none',
      }}
    >
      {to ? (
        <CardActionArea component={Link} to={to}>
          {body}
        </CardActionArea>
      ) : (
        body
      )}
    </Card>
  )
}
