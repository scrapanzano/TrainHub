import { useState } from 'react'
import { Button, MenuItem, Stack, TextField } from '@mui/material'

const LEVELS = ['Beginner', 'Intermediate', 'Advanced']

/**
 * A plan's metadata: name, goal, level, length.
 *
 * Shared by the member building their own plan and the professional writing one
 * for a client, because both produce exactly the same `createPlan` payload.
 * The form owns only its draft; who it is for, and what happens on submit,
 * belong to the caller -- which is also why it carries no offline or error
 * alert. It no longer writes anything, and a form that does not write must not
 * claim to know how a write went.
 *
 * @param {object}   props
 * @param {Function} props.onSubmit    `({name, goal, level, weeks}) => void`
 * @param {object}   props.initial     Values to reopen with, after a Back.
 * @param {string}   props.submitLabel Label for the button.
 */
export default function PlanForm({ onSubmit, initial = null, submitLabel = 'Continue' }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [goal, setGoal] = useState(initial?.goal ?? '')
  const [level, setLevel] = useState(initial?.level ?? 'Beginner')
  const [weeks, setWeeks] = useState(initial?.weeks ?? 6)

  return (
    <Stack
      component="form"
      spacing={3}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ name, goal, level, weeks: Number(weeks) })
      }}
    >
      <TextField
        label="Plan name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Hypertrophy - Phase 1"
        required
        fullWidth
      />
      <TextField
        label="Goal"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="Hypertrophy"
        fullWidth
      />
      <TextField
        select
        label="Level"
        value={level}
        onChange={(event) => setLevel(event.target.value)}
        fullWidth
      >
        {LEVELS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Weeks"
        type="number"
        value={weeks}
        onChange={(event) => setWeeks(event.target.value)}
        slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 52 } }}
        fullWidth
      />

      <Button type="submit" variant="contained" size="large" fullWidth>
        {submitLabel}
      </Button>
    </Stack>
  )
}
