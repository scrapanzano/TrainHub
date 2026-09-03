import {
  Alert, Box, Button, Card, CardContent, IconButton, Stack, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'

const WEEKDAY_INITIALS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Review the plan drafted so far, before anything is written.
 *
 * Every action here is local until `onConfirm` fires the one atomic write --
 * editing plan details, editing or deleting a drafted day never touches the
 * server.
 *
 * @param {object}   props
 * @param {object}   props.meta        `{name, kcalTarget, proteinG, carbsG, fatG, notes}`.
 * @param {Array}    props.days        `{id, name, weekdays, meals}[]`, drafted so far.
 * @param {boolean}  props.pending     The create/replace write is in flight.
 * @param {boolean}  props.paused      The write is parked offline.
 * @param {?Error}   props.error       The last failure, if any.
 * @param {Function} props.onEditMeta  Go back and edit the plan's own details.
 * @param {Function} props.onAddDay    Start drafting another day type.
 * @param {Function} props.onEditDay   `(index) => void`, reopen a drafted day.
 * @param {Function} props.onDeleteDay `(index) => void`, drop a drafted day.
 * @param {Function} props.onConfirm   Fire the one atomic write.
 */
export default function NutritionPlanSummary({
  meta, days, pending, paused, error, onEditMeta, onAddDay, onEditDay, onDeleteDay, onConfirm,
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h2">Review your plan</Typography>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h3" noWrap>{meta.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {meta.kcalTarget ?? '—'} kcal
              </Typography>
            </Box>
            <Button size="small" onClick={onEditMeta} disabled={pending}>
              Edit details
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={2}>
        {days.map((day, index) => (
          <Card key={day.id}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>{day.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {day.weekdays.length === 0
                      ? 'No days assigned'
                      : day.weekdays
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => WEEKDAY_INITIALS[d])
                        .join(', ')}
                    {' • '}{day.meals.length} meals
                  </Typography>
                </Box>
                <Button size="small" onClick={() => onEditDay(index)} disabled={pending}>
                  Edit
                </Button>
                <IconButton
                  aria-label={`Remove ${day.name}`}
                  disabled={pending}
                  onClick={() => {
                    // `confirm` rather than a dialog component: one
                    // destructive action on one screen, already accessible
                    // and blocking.
                    if (window.confirm(`Remove "${day.name}" from this plan?`)) {
                      onDeleteDay(index)
                    }
                  }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Button variant="outlined" size="large" fullWidth onClick={onAddDay} disabled={pending}>
        Add another day
      </Button>

      {/* Offline the mutation pauses: onSuccess never runs, no error is
          raised, and the button would sit on "Creating…" forever with
          nothing to explain it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. This plan is saved on your device and will be created when you
          reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">{error.message ?? 'The plan could not be created. Try again.'}</Alert>
      ) : null}

      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={days.length === 0 || pending}
        onClick={onConfirm}
      >
        {paused ? 'Saved offline' : pending ? 'Creating…' : 'Confirm & create plan'}
      </Button>
    </Stack>
  )
}
