import { Box, Card, CardActionArea, CardContent, IconButton, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { Link } from 'react-router'
import { sessionStatusOf } from '../features/workout/status.js'

/**
 * What happened, in one line.
 *
 * One line and not two.  The status label and a detail beneath it said the same
 * thing twice -- "Stopped Early" over "Stopped at 60%" -- so the specific
 * wording replaces the generic one rather than sitting under it. The coloured
 * dot beside it still carries the status, and the label survives on screens
 * that have room for it.
 *
 * No percentage. "Stopped early" is what a member needs to know at a glance;
 * "Stopped at 62%" invites arithmetic about a workout that is already over.
 * The figure is still recorded on the run and still shown on the summary, where
 * it is fresh enough to mean something.
 *
 * `run` is the run that decided the status, which is why the caller passes it
 * alongside: "Completed" is a state, "Completed on Monday" is an answer.
 */
function detailFor(status, run, runs) {
  if (status === 'in_progress') return 'Happening now'

  if (status === 'completed') {
    // A full ISO instant through the local constructor is safe -- the offset is
    // embedded.  It is a bare 'YYYY-MM-DD' that would be read as UTC midnight
    // and render as the previous day.
    return run?.ended_at
      ? `Completed on ${new Date(run.ended_at).toLocaleDateString('en-GB', { weekday: 'long' })}`
      : 'Completed'
  }

  if (status === 'partial') return 'Stopped early'

  // Nothing counts for this week.  `runStatusOf` hands back no run in that
  // case, so the session's own runs are what say whether it was ever started:
  // anything here belongs to a past week, and saying so is the whole of the
  // weekly report the plan owes the member.
  if ((runs ?? []).length > 0) return 'Not done yet — skipped last week'
  return 'Not done yet'
}

/**
 * One session in the plan.
 *
 * `status` and `run` are derived by the caller from this week's runs rather
 * than read off the row: `workout_sessions.status` is a single column that
 * freezes at the first ever completion, which is the wrong answer for a plan
 * that repeats every week.
 */
export default function SessionCard({ session, to, status, run, onDelete = null }) {
  const { color } = sessionStatusOf(status)

  const body = (
    <CardContent>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="baseline">
            <Typography variant="h3" noWrap>
              {session.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              • {session.exerciseCount} exercises
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            {/* A coloured dot alone would carry the status by hue only, so the
                wording sits next to it and the dot is hidden from the reader. */}
            <Box
              aria-hidden
              sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: `${color}.main` }}
            />
            <Typography variant="body2" color="text.secondary" noWrap>
              {detailFor(status, run, session.runs)}
            </Typography>
          </Stack>
        </Box>

        {onDelete ? null : <ChevronRightIcon color="primary" />}
      </Stack>
    </CardContent>
  )

  // In edit mode the card stops being a link: tapping it must not navigate away
  // from the list being edited, and a delete control inside a link target is
  // both a nested-interactive violation and a way to lose a session by accident.
  if (onDelete) {
    return (
      <Card>
        <Stack direction="row" alignItems="center">
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>{body}</Box>
          <IconButton
            onClick={onDelete}
            aria-label={`Delete ${session.name}`}
            sx={{ mr: 1 }}
          >
            <DeleteOutlineIcon />
          </IconButton>
        </Stack>
      </Card>
    )
  }

  return (
    <Card>
      <CardActionArea component={Link} to={to}>
        {body}
      </CardActionArea>
    </Card>
  )
}
