import { useState } from 'react'
import { IconButton, InputAdornment, TextField } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'

/**
 * A password field the user can read back.
 *
 * Five fields across three screens were blind, and Settings asks for the same
 * password twice with no way to check either -- which is the case where a typo
 * costs the most, because the mismatch is all you are told.
 *
 * Every `TextField` prop is forwarded, so call sites keep their own `label`,
 * `autoComplete`, `required` and `error`.  `type` is owned here.
 */
export default function PasswordField({ visibilityLabel = 'password', ...props }) {
  const [shown, setShown] = useState(false)

  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={() => setShown((wasShown) => !wasShown)}
                // Named, not just "Show password": three of the call sites have
                // two password fields on screen at once, and an unqualified
                // label would leave a screen reader with two identical buttons.
                aria-label={`${shown ? 'Hide' : 'Show'} ${visibilityLabel}`}
                aria-pressed={shown}
                edge="end"
              >
                {shown ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
