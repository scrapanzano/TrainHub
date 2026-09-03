import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography,
} from '@mui/material'
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents'

/**
 * Every exercise met its prescription.
 *
 * Raised the moment the last required set is logged, not on a button: a member
 * who has finished the workout should not have to tell the app so.  The single
 * action closes the run as `completed` and leads to the summary, where the note
 * for the coach is asked for while the session is still fresh.
 *
 * Deliberately not dismissible by clicking away.  The run is still open behind
 * it, and a dialog you can wave off would leave the member holding an open
 * workout they believe they finished -- which the one-open-run index would then
 * block them from starting anything else with.
 */
export default function CongratsDialog({
  open, sessionName, setCount, points, alreadyPaid = false, membershipInactive = false,
  onFinish, pending = false,
}) {
  return (
    <Dialog
      open={open}
      disableEscapeKeyDown
      aria-labelledby="congrats-title"
      slotProps={{ paper: { sx: { textAlign: 'center', px: 2, py: 1 } } }}
    >
      <DialogTitle id="congrats-title">
        <Stack spacing={1} sx={{ alignItems: 'center' }}>
          <EmojiEventsIcon color="primary" sx={{ fontSize: 56 }} aria-hidden />
          <Typography variant="h2" component="span">
            Session complete
          </Typography>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Typography color="text.secondary">
          You finished every exercise in {sessionName} — {setCount}{' '}
          {setCount === 1 ? 'set' : 'sets'} logged.
          {membershipInactive
            ? ' No points while your membership is inactive — the work still counts, and your coach still sees it.'
            : alreadyPaid
              ? ' No points this time: this session has already earned today. The work still counts, and your coach still sees it.'
              : ` That is ${points} ${points === 1 ? 'point' : 'points'}.`}
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onFinish} variant="contained" size="large" fullWidth disabled={pending}>
          {pending ? 'Saving…' : 'See how it went'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
