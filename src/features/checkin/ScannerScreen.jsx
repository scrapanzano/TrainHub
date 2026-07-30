import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Card, CardContent, Stack, TextField, Typography } from '@mui/material'
import jsQR from 'jsqr'
import { redeemCheckinToken } from '../../data/checkin.js'

const MESSAGES = {
  unknown: 'That badge is not one of ours.',
  used: 'That badge has already been used. Ask for a fresh one.',
  expired: 'That badge has expired. Ask the member to reopen the screen.',
}

export default function ScannerScreen() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  // The decode loop fires five times a second; without this the same QR is
  // redeemed repeatedly in the moment it stays in frame.
  const lastToken = useRef(null)
  const [result, setResult] = useState(null)
  const [cameraError, setCameraError] = useState(null)
  const [manual, setManual] = useState('')

  const redeem = useCallback(async (token) => {
    if (!token || token === lastToken.current) return
    lastToken.current = token
    try {
      setResult(await redeemCheckinToken(token))
    } catch (cause) {
      setResult({ status: 'error', message: cause.message })
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

        timer = setInterval(() => {
          const video = videoRef.current
          const canvas = canvasRef.current
          if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return

          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const context = canvas.getContext('2d', { willReadFrequently: true })
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const frame = context.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(frame.data, frame.width, frame.height)
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
      // A camera left running is a visible bug: the phone's indicator stays lit
      // after the screen is gone.
      if (stream) stream.getTracks().forEach((track) => track.stop())
    }
  }, [redeem])

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Scan Access Badge</Typography>

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

      {result?.status === 'ok' ? (
        <Card sx={{ bgcolor: 'success.main', color: 'common.white' }}>
          <CardContent>
            <Typography variant="h3">{result.full_name}</Typography>
            <Typography>Checked in — subscription {result.subscription_status}</Typography>
          </CardContent>
        </Card>
      ) : null}

      {result && result.status !== 'ok' ? (
        <Alert severity="error">{MESSAGES[result.status] ?? result.message}</Alert>
      ) : null}

      <Stack
        component="form"
        spacing={1}
        onSubmit={(event) => {
          event.preventDefault()
          const token = manual.trim()
          if (token === '') return
          setManual('')
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
        <Button type="submit" variant="outlined" disabled={manual.trim() === ''}>
          Check in
        </Button>
      </Stack>
    </Stack>
  )
}
