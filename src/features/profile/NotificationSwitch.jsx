import { useEffect, useState } from 'react'
import { Alert, FormControlLabel, Stack, Switch, Typography } from '@mui/material'
import {
  currentSubscription, disablePush, enablePush, pushConfigured, pushSupported,
} from './pushSubscription.js'
import { useAuth } from '../auth/useAuth.js'

export default function NotificationSwitch() {
  const { user } = useAuth()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    currentSubscription().then((subscription) => {
      if (active) setOn(Boolean(subscription))
    })
    return () => {
      active = false
    }
  }, [])

  // Called straight from the change event, not from an effect: iOS refuses a
  // permission request that is not the direct result of a user gesture.
  const toggle = async (event) => {
    const next = event.target.checked
    setBusy(true)
    setError(null)
    try {
      if (next) await enablePush(user.id)
      else await disablePush()
      setOn(next)
    } catch (cause) {
      setError(cause)
    } finally {
      setBusy(false)
    }
  }

  if (!pushSupported()) {
    return (
      <Alert severity="info">
        This browser does not support notifications. On iPhone, add TrainHub to the Home Screen
        from Safari first.
      </Alert>
    )
  }

  if (!pushConfigured()) {
    return (
      <Alert severity="info">
        Push notifications are not configured for this demo build. Messages and appointments
        remain available inside the app.
      </Alert>
    )
  }

  return (
    <Stack spacing={1}>
      <Typography variant="h3">Notifications</Typography>
      <Typography variant="body2" color="text.secondary">
        New messages, appointment updates and new plans, on this device.
      </Typography>
      <FormControlLabel
        control={<Switch checked={on} onChange={toggle} disabled={busy} />}
        label={on ? 'On' : 'Off'}
      />
      {error ? <Alert severity="error">{error.message}</Alert> : null}
    </Stack>
  )
}
