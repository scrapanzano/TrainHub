import { useEffect, useRef, useState } from 'react'
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
 * Schedule a burst on the audio clock, `seconds` from now.
 *
 * Scheduled rather than played when a timer fires, and that is the whole point:
 * every browser throttles `setInterval` in a backgrounded tab and stops it when
 * the phone locks -- which is exactly where a phone spends a rest period. The
 * Web Audio clock keeps running regardless, so a sound booked at start time
 * still lands on time.
 *
 * The context must be created and resumed inside the tap that starts the rest.
 * One constructed later, from an interval callback, is born `suspended` on iOS
 * and under Chrome's autoplay policy and stays silent for the whole session --
 * which is precisely how this first shipped, silent.
 *
 * Returns the oscillator so a cancelled rest can call `stop()` on it.
 */
function scheduleBeep(ctx, seconds) {
  const at = ctx.currentTime + Math.max(0, seconds)
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = 'sine'
  osc.frequency.value = 880

  // Silent until the moment it should sound.  Ramped rather than switched: a
  // square-edged start clicks, and on a phone speaker the click carries further
  // than the tone.
  gain.gain.setValueAtTime(0.0001, ctx.currentTime)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35)
  gain.gain.exponentialRampToValueAtTime(0.4, at + 0.45)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9)

  osc.connect(gain).connect(ctx.destination)
  osc.start(ctx.currentTime)
  osc.stop(at + 1)
  return osc
}

/**
 * Rest between sets.
 *
 * Two clocks, and neither is a counter ticked down by an interval.  The number
 * on screen is the difference between now and a target instant, so a tick the
 * browser skips costs nothing and the count is still right when the screen
 * comes back on.  The sound is booked on the Web Audio clock at the moment the
 * rest starts.
 *
 * Booking rather than playing is what makes it work at all.  Every browser
 * throttles `setInterval` in a backgrounded tab and stops it when the phone
 * locks -- which is exactly where a phone spends a rest period -- so a sound
 * played from a timer callback is a sound that arrives late or never.  Worse,
 * an `AudioContext` created from that callback is created outside a user
 * gesture and is born suspended on iOS, silent for the whole session. That is
 * how this first shipped.
 *
 * Platform limits that remain, for the report's chapter on PWA constraints:
 *
 *   Web Audio                      works, and must be unlocked inside a tap
 *   AudioContext in Safari         suspended on backgrounding, resumed on start
 *   Vibration API                  does not exist in Safari on iOS
 *   scheduled local notifications  no web API at all
 *   setInterval in the background  throttled everywhere
 *
 * So the sound is reliable while the tab is alive, including with the screen
 * off. What no web API can do is wake a page the operating system has evicted.
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
  // The unlocked audio context, kept alive across rests so it is unlocked once
  // and stays that way, plus whatever sound is currently booked on it.
  const audio = useRef({ ctx: null, osc: null })

  const running = target !== null
  const base = custom ?? seconds
  const shown = running ? remaining : base

  useEffect(() => {
    if (!running) return

    // Only the displayed number is driven from here.  The sound was booked on
    // the audio clock when the rest started, so a tick the browser skips costs
    // nothing -- neither the count, which is derived from `target`, nor the
    // beep, which is no longer this effect's business.
    //
    // No synchronous first call either: `start` seeds `remaining`, so this
    // effect only ever subscribes and writes from the interval's callback.
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)))
    }, 250)

    return () => clearInterval(id)
  }, [running, target])

  // Release the context when the screen goes.  Without this, walking between
  // exercises leaves one suspended context per visit.
  useEffect(() => () => {
    audio.current.osc?.stop()
    audio.current.ctx?.close()
    audio.current = { ctx: null, osc: null }
  }, [])

  /** Cancel whatever sound is booked, leaving the context unlocked for reuse. */
  const cancelBooked = () => {
    audio.current.osc?.stop()
    audio.current.osc = null
  }

  /** Book the finish sound `seconds` from now, unlocking the context if needed. */
  const book = (seconds) => {
    const Ctx = window.AudioContext ?? window.webkitAudioContext
    if (!Ctx) return

    audio.current.ctx ??= new Ctx()
    const { ctx } = audio.current
    // Safari suspends a context whenever the page is backgrounded, so this is
    // not only a first-run unlock -- it has to happen on every start.
    if (ctx.state === 'suspended') ctx.resume()

    cancelBooked()
    audio.current.osc = scheduleBeep(ctx, seconds)
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    } catch {
      // Remembering the choice is a convenience, not a requirement.
    }

    // Muting mid-rest has to reach the sound already booked on the audio clock;
    // unmuting has to book one for the time that is left.  Both happen inside a
    // tap, which is what keeps the context legal to touch.
    if (!running) return
    if (next) cancelBooked()
    else book((target - Date.now()) / 1000)
  }

  const start = () => {
    setRemaining(base)
    setTarget(Date.now() + base * 1000)
    // Booked from inside the tap.  This is the gesture the browser requires;
    // there is no second chance ninety seconds later.
    if (!muted) book(base)
  }

  const stop = () => {
    setTarget(null)
    cancelBooked()
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
