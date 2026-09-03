import { Alert, Button, Divider, Drawer, Stack, Typography } from '@mui/material'

/**
 * The two ways to end a workout early.
 *
 * `doc/live_train_session.md` used one word, "stop", for both -- discarding the
 * data at §67 and finishing early with weighted points at §68.  They are
 * different decisions with different consequences, so they get different
 * buttons and each says what it will do.  Collapsing them behind one control is
 * how the original screen came to award a full thirty points for a session
 * nobody had trained.
 *
 * Reaching the end of every exercise does not come through here at all: that
 * closes the run on its own and raises the congratulations dialog.
 */
export default function EndRunSheet({
  open, onClose, pct, points, setCount, alreadyPaid = false, membershipInactive = false,
  onFinish, onAbandon, pending = false,
}) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { role: 'dialog', 'aria-labelledby': 'end-run-title' } }}
    >
      <Stack spacing={3} sx={{ p: 3 }}>
        <Stack spacing={0.5}>
          <Typography id="end-run-title" variant="h2" component="h2">
            End this workout?
          </Typography>
          <Typography color="text.secondary">
            You have logged {setCount} {setCount === 1 ? 'set' : 'sets'} — {pct}% of what this
            session asks for.
          </Typography>
        </Stack>

        <Stack spacing={0.5}>
          <Button
            onClick={onFinish}
            variant="contained"
            size="large"
            fullWidth
            disabled={pending}
          >
            Finish here
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {membershipInactive
              ? 'Your sets are kept and go to your coach. No points while your membership is inactive.'
              : alreadyPaid
                ? 'Your sets are kept and go to your coach. No points: this session has already earned today.'
                : points === 0
                  ? 'Your sets are kept. No points, because nothing was logged.'
                  : `Your sets are kept and you earn ${points} ${points === 1 ? 'point' : 'points'}.`}
          </Typography>
        </Stack>

        <Divider />

        <Stack spacing={0.5}>
          <Button
            onClick={onAbandon}
            color="error"
            variant="outlined"
            size="large"
            fullWidth
            disabled={pending}
          >
            Abandon
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
            {setCount === 0
              ? 'Nothing has been logged, so nothing is lost.'
              : `Those ${setCount} sets stay in your history but count for nothing, and this session goes back to "not done".`}
          </Typography>
        </Stack>

        <Button onClick={onClose} size="large" fullWidth disabled={pending}>
          Keep training
        </Button>

        {!navigator.onLine ? (
          <Alert severity="info">
            You are offline. Ending the workout is saved on your device and sent when you reconnect.
          </Alert>
        ) : null}
      </Stack>
    </Drawer>
  )
}
