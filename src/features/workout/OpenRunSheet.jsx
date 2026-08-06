import { Alert, Button, Drawer, Stack, Typography } from '@mui/material'
import { Link } from 'react-router'
import { formatElapsed } from './timer.js'

/**
 * What to do when play is pressed and another workout is already open.
 *
 * Nothing closes silently.  Closing a session on the member's behalf means
 * deciding, for them, how many points they earned -- and the database will not
 * allow a second open run anyway (`workout_runs_one_open_per_member`), so a
 * screen that pretended otherwise would simply fail with a constraint error the
 * member could not act on.
 *
 * @param {object}  props
 * @param {?object} props.run       The open run, with its embedded session.
 * @param {number}  props.elapsed   Milliseconds it has been running.
 * @param {number}  props.setCount  Sets logged in it so far.
 * @param {Function} props.onAbandon Close it as abandoned and start the new one.
 * @param {boolean} props.pending   The abandon-and-start pair is in flight.
 */
export default function OpenRunSheet({
  open, onClose, run, elapsed, setCount, onAbandon, pending = false,
}) {
  if (!run) return null

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { role: 'dialog', 'aria-labelledby': 'open-run-title' } }}
    >
      <Stack spacing={3} sx={{ p: 3 }}>
        <Stack spacing={0.5}>
          <Typography id="open-run-title" variant="h2" component="h2">
            A workout is already open
          </Typography>
          <Typography color="text.secondary">
            {run.session?.name ?? 'A session'} — running for {formatElapsed(elapsed)},{' '}
            {setCount} {setCount === 1 ? 'set' : 'sets'} logged.
          </Typography>
        </Stack>

        <Button
          component={Link}
          to={`/m/workout/session/${run.session_id}/live`}
          variant="contained"
          size="large"
          fullWidth
          onClick={onClose}
        >
          Go back to it
        </Button>

        <Stack spacing={0.5}>
          <Button
            onClick={onAbandon}
            color="error"
            variant="outlined"
            size="large"
            fullWidth
            disabled={pending}
          >
            {pending ? 'Starting…' : 'Abandon it and start this one'}
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {setCount === 0
              ? 'Nothing has been logged in it, so nothing is lost.'
              : `Those ${setCount} sets stay in your history but earn no points.`}
          </Typography>
        </Stack>

        {/* The member may simply have mis-tapped.  Doing nothing must be as
            easy as either real choice. */}
        <Button onClick={onClose} size="large" fullWidth disabled={pending}>
          Cancel
        </Button>

        {!navigator.onLine ? (
          <Alert severity="info">
            You are offline. Both changes are saved on your device and will be sent, in order, when
            you reconnect.
          </Alert>
        ) : null}
      </Stack>
    </Drawer>
  )
}
