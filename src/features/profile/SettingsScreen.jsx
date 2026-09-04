import { useState } from 'react'
import { Alert, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import LogoutIcon from '@mui/icons-material/Logout'
import { supabase } from '../../lib/supabase.js'
import { useAuth } from '../auth/useAuth.js'
import NotificationSwitch from './NotificationSwitch.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PasswordField from '../../components/PasswordField.jsx'

export default function SettingsScreen() {
  const { user, profile, signOut } = useAuth()

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState({ phase: 'idle', message: '' })

  // Checked here only to catch the typo before a round trip. The server owns
  // the real rules -- minimum length, reuse, leaked-password checks -- and its
  // message is what the user is shown when it refuses.
  const mismatch = confirm !== '' && password !== confirm

  const onSubmit = async (event) => {
    event.preventDefault()
    if (mismatch || password === '' || status.phase === 'saving') return

    setStatus({ phase: 'saving', message: '' })
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setStatus({ phase: 'error', message: error.message })
      return
    }

    setPassword('')
    setConfirm('')
    setStatus({ phase: 'done', message: 'Your password has been changed.' })
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title="Settings"
        backTo={profile?.role === 'professional' ? '/p/profile' : '/m/profile'}
        backLabel="Back to profile"
      />

      <Card>
        <CardContent>
          <Stack component="form" spacing={2} onSubmit={onSubmit}>
            <Typography variant="h3">Change password</Typography>
            <Typography variant="body2" color="text.secondary">
              Signed in as {user?.email ?? ''}
            </Typography>

            <PasswordField
              label="New password"
              visibilityLabel="the new password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                // Clear a stale result the moment the user starts over,
                // otherwise "Your password has been changed" sits above a form
                // being filled in again.
                if (status.phase !== 'idle') setStatus({ phase: 'idle', message: '' })
              }}
              autoComplete="new-password"
              required
              fullWidth
              disabled={status.phase === 'saving'}
            />
            <PasswordField
              label="Confirm new password"
              visibilityLabel="the confirmed password"
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value)
                // Same reasoning as the password field: a stale result must not
                // sit above a form being filled in again.
                if (status.phase !== 'idle') setStatus({ phase: 'idle', message: '' })
              }}
              autoComplete="new-password"
              error={mismatch}
              helperText={mismatch ? 'The two passwords do not match' : ' '}
              required
              fullWidth
              disabled={status.phase === 'saving'}
            />

            {status.phase === 'error' ? <Alert severity="error">{status.message}</Alert> : null}
            {status.phase === 'done' ? <Alert severity="success">{status.message}</Alert> : null}

            <Button
              type="submit"
              variant="contained"
              disabled={mismatch || password === '' || status.phase === 'saving'}
            >
              {status.phase === 'saving' ? 'Saving…' : 'Change password'}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <NotificationSwitch />
        </CardContent>
      </Card>

      <Divider />

      <Button
        variant="outlined"
        color="error"
        size="large"
        startIcon={<LogoutIcon />}
        onClick={signOut}
        fullWidth
      >
        Sign out
      </Button>
    </Stack>
  )
}
