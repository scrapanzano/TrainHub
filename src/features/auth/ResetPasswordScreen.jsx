import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { supabase } from '../../lib/supabase.js'

export default function ResetPasswordScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const code = params.get('code')

  // 'exchanging' → 'ready' | 'invalid', then 'saving' → 'done'.  One state
  // machine beats four booleans that can contradict each other.
  const [phase, setPhase] = useState(code ? 'exchanging' : 'invalid')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState(null)

  // Holds the in-flight (or settled) exchange for one code.  A ref, because it
  // has to survive StrictMode's synthetic remount -- state and the effect
  // closure do not.
  const exchange = useRef(null)

  useEffect(() => {
    if (!code) return
    let active = true

    // React 19 StrictMode mounts effects twice in development, and a PKCE code
    // is single-use: exchanging twice consumes it on the first call and fails on
    // the second, turning a valid link into "Link not valid".  Reusing the same
    // promise means the code is exchanged once while every mount still gets its
    // own handler -- skipping the replay outright would instead leave the live
    // component with nothing attached, stuck on "Verifying your link…".
    if (exchange.current?.code !== code) {
      exchange.current = { code, promise: supabase.auth.exchangeCodeForSession(code) }
    }

    exchange.current.promise
      .then(({ error: exchangeError }) => {
        if (!active) return
        if (exchangeError) {
          setError(exchangeError.message)
          setPhase('invalid')
          return
        }
        setPhase('ready')
      })
      .catch((cause) => {
        if (!active) return
        setError(cause?.message ?? 'Could not verify the reset link.')
        setPhase('invalid')
      })

    return () => {
      active = false
    }
  }, [code])

  const onSubmit = async (event) => {
    event.preventDefault()
    setError(null)

    if (password !== confirmation) {
      setError('The two passwords do not match.')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters.')
      return
    }

    setPhase('saving')
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      setError(updateError.message)
      setPhase('ready')
      return
    }

    // The exchange already signed them in, so send them to the app rather than
    // making them type the password they just chose.
    setPhase('done')
    navigate('/m', { replace: true })
  }

  if (phase === 'invalid') {
    return (
      <Stack spacing={3} sx={{ width: '100%', textAlign: 'center' }}>
        <Typography variant="h1">Link not valid</Typography>
        <Typography color="text.secondary">
          {error ?? 'This reset link is missing its code.'} Reset links expire, can be used once,
          and must be opened in the same browser that requested them.
        </Typography>
        <Button component={Link} to="/forgot-password" variant="contained" size="large" fullWidth>
          Request a new link
        </Button>
      </Stack>
    )
  }

  if (phase === 'exchanging') {
    return (
      <Typography role="status" sx={{ textAlign: 'center' }}>
        Verifying your link…
      </Typography>
    )
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ width: '100%' }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">Set a new password</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Choose a password you have not used on this account before.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <TextField
        label="New password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
      />
      <TextField
        label="Confirm password"
        type="password"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        autoComplete="new-password"
        required
        fullWidth
      />

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={phase === 'saving'}
      >
        {phase === 'saving' ? 'Saving…' : 'Save password'}
      </Button>
    </Stack>
  )
}
