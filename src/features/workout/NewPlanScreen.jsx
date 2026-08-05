import { Stack, Typography } from '@mui/material'
import { useNavigate } from 'react-router'
import CreatePlanFlow from './CreatePlanFlow.jsx'
import { useAuth } from '../auth/useAuth.js'

/**
 * The member building their own plan.
 *
 * They are both the owner and the author, which is what later gives them the
 * edit entry on the plan screen -- a plan is editable by whoever wrote it, so a
 * coach-written plan shows no edit control here and a self-written one does.
 *
 * Replaces the old builder screen, which could only add a session to a plan
 * that already existed and so could never be reached by a member who had none.
 */
export default function NewPlanScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Your plan</Typography>
      <CreatePlanFlow
        memberId={user.id}
        authorId={user.id}
        // `replace`, so Back leaves the plan rather than reopening the form
        // that just created it.
        onDone={() => navigate('/m/workout', { replace: true })}
      />
    </Stack>
  )
}
