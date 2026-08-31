import { Box, Button, Stack, Typography } from '@mui/material'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import { Link } from 'react-router'
import { formatElapsed } from '../features/workout/timer.js'

/**
 * A workout in progress, visible from anywhere in the app.
 *
 * `doc/live_train_session.md` asked for a lock-screen overlay in the style of
 * Spotify.  That runs through the Media Session API, which only attaches to
 * real audio playback; holding it open with a silent looping track is
 * unreliable in a PWA on iOS and drains the battery for the length of a
 * workout.  This solves the problem that overlay was reaching for -- "I left
 * the workout and cannot find my way back" -- and it actually works.
 *
 * Renders props only, per the rule that `components/` neither fetches nor
 * calls Supabase.  The open run lives in the database rather than in this tab,
 * so the bar comes back after a reload, a cleared cache, or on another phone.
 */
export default function LiveSessionBar({ sessionName, sessionId, elapsed, paused }) {
  if (!sessionId) return null

  return (
    <Box
      sx={{
        px: 2, py: 1,
        bgcolor: 'primary.main',
        color: 'primary.contrastText',
        borderTop: 1,
        borderColor: 'primary.dark',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {/* The dot pulses only while the clock runs, so "paused" is carried by
            motion as well as by the word next to it. */}
        <FiberManualRecordIcon
          aria-hidden
          sx={{
            fontSize: 12,
            opacity: paused ? 0.4 : 1,
            animation: paused ? 'none' : 'trainhub-live-pulse 2s ease-in-out infinite',
            '@keyframes trainhub-live-pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.3 },
            },
            // Respect a member who has asked their phone to stop moving things.
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        />

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
            {sessionName}
          </Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', opacity: 0.9 }}>
            {paused ? 'Paused' : formatElapsed(elapsed)}
          </Typography>
        </Box>

        <Button
          component={Link}
          to={`/m/workout/session/${sessionId}/live`}
          size="small"
          sx={{ color: 'inherit', borderColor: 'currentColor' }}
          variant="outlined"
        >
          Resume
        </Button>
      </Stack>
    </Box>
  )
}
