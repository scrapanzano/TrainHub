import { Box, Paper, Stack, Typography } from '@mui/material'
import DoneIcon from '@mui/icons-material/Done'
import DoneAllIcon from '@mui/icons-material/DoneAll'

/**
 * One message.
 *
 * @param {object}  props
 * @param {object}  props.message The row.
 * @param {boolean} props.mine    Written by the signed-in user.
 */
export default function MessageBubble({ message, mine }) {
  const time = new Date(message.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <Stack direction="row" justifyContent={mine ? 'flex-end' : 'flex-start'}>
      <Paper
        elevation={0}
        sx={{
          maxWidth: '80%',
          px: 2,
          py: 1.25,
          borderRadius: 3,
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

        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="flex-end" sx={{ mt: 0.5 }}>
          <Typography variant="body2" sx={{ opacity: 0.7 }}>
            {time}
          </Typography>
          {/* Only the sender is told whether their message was read; showing a
              receipt on the other party's message would be meaningless. MUI
              hides an SvgIcon from screen readers without titleAccess. */}
          {mine ? (
            <Box sx={{ display: 'flex', opacity: 0.8 }}>
              {message.read_at ? (
                <DoneAllIcon fontSize="small" titleAccess="Read" />
              ) : (
                <DoneIcon fontSize="small" titleAccess="Sent" />
              )}
            </Box>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  )
}
