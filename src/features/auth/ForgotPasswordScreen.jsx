import { useState } from 'react'
import { Alert, Box, Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase.js'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      // Built from the live origin so the same code works on localhost, on the
      // preview server and behind the ngrok tunnel.  Every origin used must also
      // be listed in Supabase → Authentication → URL Configuration → Redirect
      // URLs, or Supabase silently sends the user to the Site URL instead.
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (resetError) {
      setError(resetError.message)
      setSubmitting(false)
      return
    }

    setSent(true)
    setSubmitting(false)
  }

  return (
    <Stack component="form" onSubmit={onSubmit} spacing={3} sx={{ width: '100%' }}>
      <Box>
        <IconButton component={Link} to="/login" aria-label="Back to login" edge="start">
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="h1">Forgot Password?</Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          Don&apos;t worry! Enter the email address associated with your account and we&apos;ll send
          you a link to reset your password.
        </Typography>
      </Box>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {/* Confirmed without saying whether the address exists -- the same wording
          appears either way, so this screen cannot be used to enumerate users. */}
      {sent ? (
        <Alert severity="success">
          If an account exists for {email}, a reset link is on its way. Check your inbox.
        </Alert>
      ) : null}

      <TextField
        label="Email"
        type="email"
        value={email}
        onChange={(event) => {
          setEmail(event.target.value)
          // Editing the address re-arms the button.  Without this, a user who
          // mistyped and submitted is stuck: the confirmation disables the
          // button permanently and the only escape is remounting the screen.
          setSent(false)
          setError(null)
        }}
        placeholder="name@email.com"
        autoComplete="email"
        required
        fullWidth
      />

      <Button type="submit" variant="contained" size="large" fullWidth disabled={submitting || sent}>
        {submitting ? 'Sending…' : 'Send Link'}
      </Button>
    </Stack>
  )
}
