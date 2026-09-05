import { Box, Paper, Stack, Typography } from '@mui/material'
import DoneIcon from '@mui/icons-material/Done'
import DoneAllIcon from '@mui/icons-material/DoneAll'

/**
 * One message.
 *
 * Consecutive messages from the same sender are drawn as one run: only the
 * last of a run carries the tail corner and the timestamp. Before this, every
 * bubble repeated the clock and the receipt, so three quick messages produced
 * three identical timestamps down the side of the thread and the eye had
 * nothing left to tell one turn from the next.
 *
 * @param {object}  props
 * @param {object}  props.message The row.
 * @param {boolean} props.mine    Written by the signed-in user.
 * @param {boolean} props.tail    Last of its run: gets the corner and the time.
 */
export default function MessageBubble({ message, mine, tail = true }) {
  const time = new Date(message.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  // A rounded square with one corner squared off on the sender's side, which
  // is the shape every messaging app has settled on for the same reason: it
  // points at whoever is speaking without needing a label.
  const radius = mine
    ? `18px ${tail ? '6px' : '18px'} 18px 18px`
    : `18px 18px 18px ${tail ? '6px' : '18px'}`

  return (
    <Stack direction="row" sx={{ justifyContent: mine ? 'flex-end' : 'flex-start' }}>
      <Paper
        elevation={0}
        sx={{
          maxWidth: '78%',
          px: 1.75,
          py: 1,
          borderRadius: radius,
          // The sender's own messages take the brand colour; the other party's
          // stay on paper, so the two sides are distinguishable without reading.
          bgcolor: mine ? 'primary.main' : 'background.paper',
          color: mine ? 'primary.contrastText' : 'text.primary',
          border: mine ? 'none' : 1,
          borderColor: 'divider',
        }}
      >
        <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {message.body}
        </Typography>

        {tail ? (
          <Stack
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center', justifyContent: 'flex-end', mt: 0.25 }}
          >
            <Typography variant="body2" sx={{ fontSize: '0.6875rem', opacity: 0.7 }}>
              {time}
            </Typography>
            {/* Only the sender is told whether their message was read; showing a
                receipt on the other party's message would be meaningless. MUI
                hides an SvgIcon from screen readers without titleAccess. */}
            {mine ? (
              <Box sx={{ display: 'flex', opacity: 0.8 }}>
                {message.read_at ? (
                  <DoneAllIcon sx={{ fontSize: 15 }} titleAccess="Read" />
                ) : (
                  <DoneIcon sx={{ fontSize: 15 }} titleAccess="Sent" />
                )}
              </Box>
            ) : null}
          </Stack>
        ) : null}
      </Paper>
    </Stack>
  )
}
