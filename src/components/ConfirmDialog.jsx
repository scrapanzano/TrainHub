import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

/**
 * The app's one way to ask "are you sure?".
 *
 * Eight destructive actions used `window.confirm`, which cannot be styled,
 * cannot mark which button is the dangerous one, blocks the main thread, and
 * looks like it belongs to the browser rather than to the app -- while the
 * same app already confirmed starting a session with a proper dialog.  One
 * paradigm, and the destructive choice carries its own weight.
 *
 * @param {object}   props
 * @param {boolean}  props.open
 * @param {string}   props.title          The question.
 * @param {string}   [props.description]  What the confirmation costs.
 * @param {string}   [props.confirmLabel] The verb, never "OK".
 * @param {string}   [props.cancelLabel]
 * @param {boolean}  [props.destructive]  Colours the confirm button red.
 * @param {boolean}  [props.busy]         Disables both buttons while in flight.
 * @param {Function} props.onConfirm
 * @param {Function} props.onCancel       Also fires on backdrop and Escape.
 */
export default function ConfirmDialog({
  open,
  title,
  description = null,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      {description ? (
        <DialogContent>
          <DialogContentText>{description}</DialogContentText>
        </DialogContent>
      ) : null}
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        {/* Cancel first and quiet, the destructive verb last and coloured: the
            safe way out should be the one the thumb finds without aiming. */}
        <Button onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          variant="contained"
          color={destructive ? 'error' : 'primary'}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
