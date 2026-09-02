import {
  Alert, Box, Button, Card, CardContent, IconButton, Stack, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'

/**
 * Review the sessions drafted so far, before anything is written.
 *
 * Every action here is local until `onConfirm` fires the one atomic write --
 * editing or deleting a drafted session never touches the server.
 *
 * @param {object}   props
 * @param {Array}    props.sessions        `{id, name, exercises}[]`, drafted so far.
 * @param {boolean}  props.pending         The create/replace write is in flight.
 * @param {boolean}  props.paused          The write is parked offline.
 * @param {?Error}   props.error           The last failure, if any.
 * @param {Function} props.onAddSession    Start drafting another session.
 * @param {Function} props.onEditSession   `(index) => void`, reopen a drafted session.
 * @param {Function} props.onDeleteSession `(index) => void`, drop a drafted session.
 * @param {Function} props.onConfirm       Fire the one atomic write.
 */
export default function PlanSummary({
  sessions,
  pending,
  paused,
  error,
  onAddSession,
  onEditSession,
  onDeleteSession,
  onConfirm,
}) {
  return (
    <Stack spacing={3}>
      <Typography variant="h1">Review your plan</Typography>

      <Stack spacing={2}>
        {sessions.map((session, index) => (
          <Card key={session.id}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>{session.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {session.exercises.length} exercises
                  </Typography>
                </Box>
                <Button size="small" onClick={() => onEditSession(index)} disabled={pending}>
                  Edit
                </Button>
                <IconButton
                  aria-label={`Remove ${session.name}`}
                  disabled={pending}
                  onClick={() => {
                    // `confirm` rather than a dialog component: one destructive
                    // action on one screen, already accessible and blocking.
                    if (window.confirm(`Remove "${session.name}" from this plan?`)) {
                      onDeleteSession(index)
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

      <Button variant="outlined" size="large" fullWidth onClick={onAddSession} disabled={pending}>
        Add another session
      </Button>

      {/* Offline the mutation pauses: `onSuccess` never runs, no error is
          raised, and the button would sit on "Creating…" forever with nothing
          to explain it. */}
      {paused ? (
        <Alert severity="info">
          You are offline. This plan is saved on your device and will be created when you
          reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">
          {error.message ?? 'The plan could not be created. Try again.'}
        </Alert>
      ) : null}

      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={sessions.length === 0 || pending}
        onClick={onConfirm}
      >
        {paused ? 'Saved offline' : pending ? 'Creating…' : 'Confirm & create plan'}
      </Button>
    </Stack>
  )
}
