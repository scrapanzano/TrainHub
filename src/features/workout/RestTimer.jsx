import { useEffect, useRef, useState } from 'react'
import { Button, Card, CardContent, IconButton, Stack, TextField, Typography } from '@mui/material'
import RemoveIcon from '@mui/icons-material/Remove'
import AddIcon from '@mui/icons-material/Add'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import VolumeOffIcon from '@mui/icons-material/VolumeOff'
import { BEEP_DATA_URI } from './beep.js'

const MUTE_KEY = 'trainhub-rest-muted'
const MIN_SECONDS = 15
const MAX_SECONDS = 600

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
 * Ask iOS to duck other audio rather than take it over.
 *
 * `navigator.audioSession` is WebKit's, from Safari 16.4. Without it a chime
 * plays in the default category, which STOPS whatever the member was listening
 * to -- and someone who trains to music does not want their album killed by a
 * rest timer.
 *
 *   transient        lowers other audio for the length of the sound
 *   transient-solo   pauses other audio
 *   playback         takes the session over entirely
 *   ambient          mixes, but is silenced by the ring/silent switch
 *
 * `transient` is what the system timer does. Guarded because the API exists
 * nowhere else, and everywhere else the browser already mixes.
 */
function duckOtherAudio() {
  if (navigator.audioSession) navigator.audioSession.type = 'transient'
}

const clamp = (n) => Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n))
const mmss = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`

/**
 * Rest between sets.
 *
 * The number on screen is the difference between now and a target instant,
 * never a counter ticked down by an interval: every browser throttles
 * `setInterval` in a backgrounded tab, and derived from a timestamp the count
 * is still right when the screen comes back on.
 *
 * The sound goes through an `<audio>` element, unlocked inside the tap that
 * starts the rest. Web Audio was tried first and is silent on any iPhone whose
 * ring/silent switch is on, because Safari routes an `AudioContext` through the
 * ambient audio category -- which is most iPhones in a gym, and which no web
 * API can override. The media path an `<audio>` element uses ignores that
 * switch.
 *
 * Platform limits that remain, for the report's chapter on PWA constraints:
 *
 *   <audio>, unlocked by a gesture   works, and ignores the iOS silent switch
 *   Web Audio                        muted by that switch on iOS
 *   Vibration API                    does not exist in Safari on iOS
 *   scheduled local notifications    no web API at all
 *   setInterval in the background    throttled everywhere, frozen on iOS
 *
 * So the sound is reliable while the tab is alive. It is not reliable with the
 * app backgrounded or the phone locked, and nothing on the web makes it so --
 * which is why the finish is also announced to a screen reader and stated in
 * text, rather than being carried by sound alone.
 */
export default function RestTimer({ seconds }) {
  // The member's own duration, or null to follow the coach's prescription.
  // Held as an override rather than as a copy of `seconds`: mirroring a prop
  // into state needs an effect to keep them in step, and that effect is both a
  // cascading render and the thing that would quietly undo an adjustment.
  const [custom, setCustom] = useState(null)
  const [target, setTarget] = useState(null)
  const [remaining, setRemaining] = useState(0)
  const [muted, setMuted] = useState(readMuted)
  const [editing, setEditing] = useState(null)

  const audio = useRef(null)
  // Guards the boundary: without it a late tick could sound the chime twice.
  const rung = useRef(false)

  const running = target !== null
  const base = custom ?? seconds
  const shown = running ? remaining : base

  useEffect(() => {
    if (!running) return

    // No synchronous first call: `start` seeds `remaining`, so this effect only
    // ever subscribes to the interval and writes state from its callback.
    const id = setInterval(() => {
      const left = Math.max(0, Math.ceil((target - Date.now()) / 1000))
      setRemaining(left)

      if (left === 0 && !rung.current) {
        rung.current = true
        // Already unlocked by the tap that started the rest, so this is not a
        // fresh autoplay attempt and the browser allows it.  Re-asserted here
        // because the category is global and something else may have moved it.
        if (!muted) {
          duckOtherAudio()
          audio.current?.play().catch(() => {})
        }
      }
    }, 250)

    return () => clearInterval(id)
  }, [running, target, muted])

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    try {
      localStorage.setItem(MUTE_KEY, next ? '1' : '0')
    } catch {
      // Remembering the choice is a convenience, not a requirement.
    }
  }

  const start = () => {
    rung.current = false
    setEditing(null)

    // The unlock, and the whole reason this lives in a click handler: an
    // <audio> element may only be played later without a gesture once it has
    // been played with one.
    //
    // Unlocked MUTED. Playing it audibly here -- even for the few milliseconds
    // before the pause -- is enough to seize the phone's audio session and cut
    // off whatever the member is listening to, at the start of the rest rather
    // than at its end. `muted` is settable on iOS; `volume` is read-only there,
    // so it is the only lever available.
    const el = audio.current
    if (el && !muted) {
      duckOtherAudio()
      el.muted = true
      el.play()
        .then(() => {
          el.pause()
          el.currentTime = 0
          el.muted = false
        })
        .catch(() => {
          el.muted = false
        })
    }

    setRemaining(base)
    setTarget(Date.now() + base * 1000)
  }

  const stop = () => {
    setTarget(null)
    rung.current = false
  }

  const adjust = (delta) => {
    if (running) return
    setCustom(clamp(base + delta))
  }

  const commitEdit = () => {
    const parsed = Number(editing)
    // A blank or unparseable entry leaves the duration alone rather than
    // snapping it to a bound the member never asked for.
    if (Number.isFinite(parsed) && parsed > 0) setCustom(clamp(Math.round(parsed)))
    setEditing(null)
  }

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

          {editing !== null ? (
            <TextField
              value={editing}
              onChange={(event) => setEditing(event.target.value)}
              onBlur={commitEdit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitEdit()
                if (event.key === 'Escape') setEditing(null)
              }}
              type="number"
              label="Seconds"
              slotProps={{
                htmlInput: {
                  inputMode: 'numeric',
                  min: MIN_SECONDS,
                  max: MAX_SECONDS,
                  'aria-label': 'Rest duration in seconds',
                },
              }}
              autoFocus
              sx={{ width: 150 }}
            />
          ) : (
            // Tapping the clock types a duration straight in.  The ±15 buttons
            // are four taps from two minutes and nineteen from five, which is a
            // long way to walk for a number the member already knows.
            <Typography
              variant="h1"
              component={running ? 'p' : 'button'}
              type={running ? undefined : 'button'}
              role="timer"
              aria-live={running && shown === 0 ? 'assertive' : 'off'}
              onClick={running ? undefined : () => setEditing(String(base))}
              sx={{
                fontVariantNumeric: 'tabular-nums',
                minWidth: 150,
                textAlign: 'center',
                border: 0,
                p: 0,
                bgcolor: 'transparent',
                color: 'inherit',
                font: 'inherit',
                cursor: running ? 'default' : 'pointer',
              }}
            >
              {mmss(shown)}
            </Typography>
          )}

          <IconButton onClick={() => adjust(15)} disabled={running} aria-label="15 seconds more">
            <AddIcon />
          </IconButton>
        </Stack>

        {!running && editing === null ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 0.5 }}>
            Tap the time to change it
          </Typography>
        ) : null}

        <Button
          onClick={running ? stop : start}
          variant={running ? 'outlined' : 'contained'}
          size="large"
          fullWidth
          sx={{ mt: 2 }}
          disabled={editing !== null}
        >
          {running ? (shown === 0 ? 'Done — reset' : 'Cancel rest') : 'Start rest'}
        </Button>

        {running && shown === 0 ? (
          <Typography color="primary" sx={{ mt: 1, textAlign: 'center', fontWeight: 700 }}>
            Time — next set.
          </Typography>
        ) : null}

        {/* `preload="auto"` so the clip is decoded well before the rest ends,
            rather than at the instant it has to sound. */}
        <audio ref={audio} src={BEEP_DATA_URI} preload="auto" />
      </CardContent>
    </Card>
  )
}
