import { Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router'
import CreatePlanFlow from './CreatePlanFlow.jsx'
import { useAuth } from '../auth/useAuth.js'

/**
 * The member building their own plan.
 *
 * They are both the owner and the author -- `create_workout_plan_secure`
 * (patches/017) authorizes this via `owns_member`, which is true for the
 * caller acting on themselves as well as for their assigned professional.
 */
export default function NewPlanScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Your plan</Typography>
      <CreatePlanFlow
        memberId={user.id}
        // `replace`, so Back leaves the plan rather than reopening the form
        // that just created it.
        onDone={() => navigate('/m/workout', { replace: true })}
        onAbandon={() => navigate('/m/workout', { replace: true })}
      />
    </Stack>
  )
}
