import { useState } from 'react'
import { Alert, Box, Button, Link as MuiLink, Stack, TextField, Typography } from '@mui/material'
import { Link, Navigate, useLocation } from 'react-router'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from './useAuth.js'
import PasswordField from '../../components/PasswordField.jsx'

const HOME_FOR = { member: '/m', professional: '/p' }

export default function LoginScreen() {
  const { user, profile, loading } = useAuth()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  // Redirect on rendered state rather than from the submit handler.  The session
  // arrives through onAuthStateChange, and the profile that decides WHERE to go
  // arrives one fetch later; navigating from the handler would race both.
  //
  // The condition is "settled", not "profile arrived".  A profile that failed to
  // load is a resolved state too -- the provider stops loading and leaves the
  // profile null -- and waiting for one that is never coming would strand this
  // screen on a disabled "Logging in…" button with nothing to explain why.
  // AppLayout owns that failure screen and offers the way out, so hand off.
  if (user && !loading) {
    return <Navigate to={location.state?.from ?? HOME_FOR[profile?.role] ?? '/m'} replace />
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

    if (signInError) {
      // Supabase answers "Invalid login credentials" for a wrong password AND
      // for an unconfirmed address, on purpose -- it will not reveal which
      // addresses are registered.  Passing it through unchanged keeps that.
      setError(signInError.message)
      setSubmitting(false)
      return
    }
    // Deliberately no setSubmitting(false) on success: the redirect above
    // unmounts this screen, and re-enabling the button first lets an impatient
    // second tap fire a second sign-in.
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ width: '100%' }}>
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">
          Welcome to Train<Box component="span" sx={{ color: 'primary.main' }}>Hub</Box>
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Log In to begin your fitness journey.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Stack spacing={2}>
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="name@email.com"
          autoComplete="email"
          required
          fullWidth
        />
        <Box>
          <PasswordField
            label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            fullWidth
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <MuiLink component={Link} to="/forgot-password" underline="hover">
              Forgot Password?
            </MuiLink>
          </Box>
        </Box>
      </Stack>

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        // `loading` covers the gap between a restored session and its profile:
        // without it the form is briefly live underneath a redirect about to fire.
        disabled={submitting || loading}
      >
        {submitting ? 'Logging in…' : 'Log In'}
      </Button>
    </Stack>
  )
}
