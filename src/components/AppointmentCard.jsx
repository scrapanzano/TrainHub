import { Avatar, Box, Card, CardActionArea, CardContent, Chip, Stack, Typography } from '@mui/material'
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
      {/* No leading status glyph: the wireframes drew an empty circle here as
          a quick "mark it done" control, which was never built.  It stayed as
          decoration that looked like a checkbox, and it said exactly what the
          status chip two lines below already says. */}
      {/* Time, kind and person read as one column; the status sits opposite
          them rather than in the middle of that column, where it split the
          appointment's name from the person it is with. Centred on the block,
          so a two-line card and a three-line card both keep it beside the
          kind. */}
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary">
            {formatTimeRange(startsAt, endsAt)}
          </Typography>
          <Typography variant="h3" noWrap>
            {KIND_LABEL[kind] ?? 'Appointment'}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
            <Avatar src={person?.avatar_url ?? undefined} sx={{ width: 20, height: 20 }}>
              {person?.full_name?.[0] ?? '?'}
            </Avatar>
            <Typography variant="body2" color="text.secondary" noWrap>
              {person?.full_name ?? 'Unassigned'}
            </Typography>
          </Stack>
        </Box>

        <Chip
          size="small"
          label={statusLabel}
          color={
            status === 'cancelled'
              ? 'error'
              : status === 'done' || status === 'confirmed'
                ? 'success'
                : 'warning'
          }
          sx={{ flexShrink: 0 }}
        />
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
