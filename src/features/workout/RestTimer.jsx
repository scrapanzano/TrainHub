import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, CardContent, IconButton, Stack, Typography } from '@mui/material'
import RemoveIcon from '@mui/icons-material/Remove'
import AddIcon from '@mui/icons-material/Add'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import VolumeOffIcon from '@mui/icons-material/VolumeOff'

const MUTE_KEY = 'trainhub-rest-muted'

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    // Private mode on some browsers throws on any localStorage access.  A rest
    // timer that beeps is a better failure than one that will not render.
    return false
  }
}

/**
 * A short burst, loud enough to hear over a gym.
 *
 * The `AudioContext` is created inside the gesture that starts the timer, never
 * at module scope: one constructed without a user gesture starts suspended on
 * iOS and stays silent for the whole session.
 */
function beep() {
  const Ctx = window.AudioContext ?? window.webkitAudioContext
  if (!Ctx) return

  const ctx = new Ctx()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.001, ctx.currentTime)
  // Ramped rather than switched: a square-edged start clicks, and on a phone
  // speaker the click is louder than the tone.
  gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7)

  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.75)
  osc.onended = () => ctx.close()
}

/**
 * Rest between sets.
 *
 * The countdown is the difference between now and a target instant, never a
 * counter ticked down by an interval.  Every browser throttles timers in a
 * backgrounded tab and stops them when the phone locks, which is exactly when a
 * member is resting -- derived from timestamps, the number is still right when
 * the screen comes back on, and only the sound is at risk.
 *
 * Known platform limits, which belong in the report's chapter on PWA
 * constraints rather than in a comment apologising for them:
 *
 *   Web Audio                      works, needs one gesture to unlock
 *   Vibration API                  does not exist in Safari on iOS
 *   scheduled local notifications  no web API at all
 *   setInterval in the background  throttled everywhere
 *
 * So: app open and screen awake, the sound is reliable. Phone locked, it may be
 * late or absent. There is no web mechanism that changes this.
 */
export default function RestTimer({ seconds }) {
  // The member's own duration, or null to follow the coach's prescription.
  // Held as an override rather than as a copy of `seconds`: mirroring a prop
  // into state needs an effect to keep the two in step, and that effect is both
  // a cascading render and the thing that would quietly undo an adjustment.
  const [custom, setCustom] = useState(null)
  const [target, setTarget] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [muted, setMuted] = useState(readMuted)
  // Guards the boundary: without it a late tick could fire the sound twice.
  const rung = useRef(false)

  const running = target !== null
  const base = custom ?? seconds
  const shown = running ? remaining : base

  useEffect(() => {
    if (!running) return

    // No synchronous first call: `start` seeds `remaining`, so the effect only
    // ever subscribes to the interval and writes state from its callback.
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((target - Date.now()) / 1000))
      setRemaining(left)

      if (left === 0 && !rung.current) {
        rung.current = true
        if (!muted) beep()
      }
    }, 250)

    return () => clearInterval(id)
  }, [running, target, muted])

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current
      try {
        localStorage.setItem(MUTE_KEY, next ? '1' : '0')
      } catch {
        // Remembering the choice is a convenience, not a requirement.
      }
      return next
    })
  }, [])

  const start = () => {
    rung.current = false
    setRemaining(base)
    setTarget(Date.now() + base * 1000)
  }

  const stop = () => {
    setTarget(null)
    rung.current = false
  }

  const adjust = (delta) => {
    if (running) return
    // Clamped: 15 seconds is the shortest rest worth timing, ten minutes the
    // longest anyone waits between sets.
    setCustom(Math.min(600, Math.max(15, base + delta)))
  }

  const mmss = `${String(Math.floor(shown / 60)).padStart(2, '0')}:${String(shown % 60).padStart(2, '0')}`

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h3">Rest</Typography>
          <IconButton
            onClick={toggleMute}
            aria-label={muted ? 'Unmute the rest timer' : 'Mute the rest timer'}
            size="small"
          >
            {muted ? <VolumeOffIcon fontSize="small" /> : <VolumeUpIcon fontSize="small" />}
          </IconButton>
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="center" spacing={2}>
          <IconButton onClick={() => adjust(-15)} disabled={running} aria-label="15 seconds less">
            <RemoveIcon />
          </IconButton>

          {/* role="timer" so a screen reader is told this is a running clock,
              and aria-live announces the finish rather than only sounding it --
              which is also the fallback when the sound is muted. */}
          <Typography
            variant="h1"
            component="p"
            role="timer"
            aria-live={shown === 0 && running ? 'assertive' : 'off'}
            sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 140, textAlign: 'center' }}
          >
            {mmss}
          </Typography>

          <IconButton onClick={() => adjust(15)} disabled={running} aria-label="15 seconds more">
            <AddIcon />
          </IconButton>
        </Stack>

        <Button
          onClick={running ? stop : start}
          variant={running ? 'outlined' : 'contained'}
          size="large"
          fullWidth
          sx={{ mt: 2 }}
        >
          {running ? (shown === 0 ? "Done — reset" : "Cancel rest") : "Start rest"}
        </Button>

        {running && remaining === 0 ? (
          <Typography color="primary" sx={{ mt: 1, textAlign: 'center', fontWeight: 700 }}>
            Time — next set.
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  )
}
