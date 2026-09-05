import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import jsQR from 'jsqr'
import { redeemCheckinToken } from '../../data/checkin.js'
import { scanResultView } from './scanResult.js'
import PageHeader from '../../components/PageHeader.jsx'

export default function ScannerScreen() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  // The decode loop fires five times a second; without this the same QR is
  // redeemed repeatedly in the moment it stays in frame.
  const lastToken = useRef(null)
  // Re-arms lastToken after a thrown error, on a delay — an immediate clear
  // would let the 200ms decode loop hammer the RPC every tick for as long as
  // the badge sits in frame during an outage.
  const cooldownTimer = useRef(null)
  const [result, setResult] = useState(null)
  const [redeeming, setRedeeming] = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [manual, setManual] = useState('')

  const redeem = useCallback(async (token) => {
    if (!token || token === lastToken.current) return
    if (cooldownTimer.current) {
      clearTimeout(cooldownTimer.current)
      cooldownTimer.current = null
    }
    lastToken.current = token
    setResult(null)
    setRedeeming(true)
    try {
      setResult(await redeemCheckinToken(token))
    } catch (cause) {
      setResult({ status: 'error', message: cause.message })
      cooldownTimer.current = setTimeout(() => {
        lastToken.current = null
        cooldownTimer.current = null
      }, 3000)
    } finally {
      setRedeeming(false)
    }
  }, [])

  useEffect(() => {
    let stream = null
    let timer = null
    let cancelled = false

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        if (cancelled) {
          return
        }

        timer = setInterval(() => {
          const video = videoRef.current
          const canvas = canvasRef.current
          if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return

          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const frame = context.getImageData(0, 0, canvas.width, canvas.height)
          let code
          try {
            code = jsQR(frame.data, frame.width, frame.height)
          } catch {
            return
          }
          if (code) redeem(code.data)
        }, 200)
      } catch (cause) {
        setCameraError(cause)
      }
    }

    start()

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
      if (cooldownTimer.current) {
        clearTimeout(cooldownTimer.current)
        cooldownTimer.current = null
      }
      // A camera left running is a visible bug: the phone's indicator stays lit
      // after the screen is gone.
      if (stream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [redeem])

  const resultView = result ? scanResultView(result) : null

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader title="Scan Access Badge" backTo="/p" backLabel="Back to today" />

      {cameraError ? (
        <Alert severity="warning">
          The camera is unavailable. Check the permission, or type the code below.
        </Alert>
      ) : (
        <Box
          sx={{
            position: 'relative',
            borderRadius: 2,
            overflow: 'hidden',
            bgcolor: 'common.black',
            aspectRatio: '1 / 1',
          }}
        >
          <Box
            component="video"
            ref={videoRef}
            muted
            playsInline
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </Box>
      )}

      {/* Never rendered: it is the frame buffer jsQR reads. */}
      <Box component="canvas" ref={canvasRef} sx={{ display: 'none' }} />

      {redeeming ? <Alert severity="info">Checking badge...</Alert> : null}

      {resultView?.accepted ? (
        <Card sx={{ bgcolor: 'success.main', color: 'common.white' }}>
          <CardContent>
            <Typography variant="h3">{result.full_name}</Typography>
            <Typography>Checked in — subscription {result.subscription_status}</Typography>
          </CardContent>
        </Card>
      ) : null}

      {resultView && !resultView.accepted ? (
        <Alert severity="error">
          <Typography component="span" fontWeight={700}>{resultView.title}.</Typography>{' '}
          {resultView.message}
        </Alert>
      ) : null}

      <Stack
        component="form"
        spacing={1}
        onSubmit={(event) => {
          event.preventDefault()
          // The badge code is uppercase-only with no whitespace; normalise a
          // hand-typed entry the same way before it's compared.
          const token = manual.trim().toUpperCase().replace(/\s+/g, '')
          if (token === '') return
          setManual('')
          // Camera frames are deduplicated automatically, but pressing the
          // manual button again is an explicit request to check the token's
          // current server state (for example, to show `already used`).
          lastToken.current = null
          redeem(token)
        }}
      >
        <Typography variant="h2">Enter a code by hand</Typography>
        <Typography variant="body2" color="text.secondary">
          For when the camera will not start.
        </Typography>
        <TextField
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          label="Badge code"
          fullWidth
        />
        <Button type="submit" variant="outlined" disabled={redeeming || manual.trim() === ''}>
          Check in
        </Button>
      </Stack>
    </Stack>
  )
}
