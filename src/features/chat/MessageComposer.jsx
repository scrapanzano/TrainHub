import { useState } from 'react'
import { Alert, IconButton, Stack, TextField } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'

/**
 * The send box.
 *
 * @param {object}   props
 * @param {Function} props.onSend `(body) => void`
 * @param {boolean}  props.paused  The send is parked offline.
 * @param {?Error}   props.error   The last failure, if any.
 */
export default function MessageComposer({ onSend, paused, error }) {
  const [body, setBody] = useState('')
  const empty = body.trim() === ''

  const submit = (event) => {
    event.preventDefault()
    if (empty) return
    onSend(body.trim())
    // Cleared immediately rather than on success: offline the mutation pauses
    // and never resolves, and a composer that will not clear until reconnect
    // makes the app feel broken in exactly the case it was built for. The
    // message is already queued and on screen -- `sendMessage`'s `onMutate` in
    // `src/data/mutations.js` appends it to the thread before the write runs.
    setBody('')
  }

  return (
    <Stack spacing={1}>
      {paused ? (
        <Alert severity="info">
          You are offline. This message is saved on your device and will be sent when you reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">{error.message ?? 'The message could not be sent.'}</Alert>
      ) : null}

      <Stack component="form" direction="row" spacing={1} onSubmit={submit}>
        <TextField
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write a message…"
          aria-label="Message"
          fullWidth
          multiline
          maxRows={4}
        />
        {/* Not disabled while pending: offline a mutation stays pending until it
            reconnects, and blocking the second message would be the same trap
            the log-set sheet hit in Phase 2. */}
        <IconButton type="submit" color="primary" disabled={empty} aria-label="Send message">
          <SendIcon />
        </IconButton>
      </Stack>
    </Stack>
  )
}
