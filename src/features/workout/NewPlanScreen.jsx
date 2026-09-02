import { Alert, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import CreatePlanFlow from './CreatePlanFlow.jsx'
import { useAuth } from '../auth/useAuth.js'

/**
 * The member building their own plan.
 *
 * They are both the owner and the author -- `create_workout_plan_secure`
 * (patches/017) authorizes this via `owns_member`, which is true for the
 * caller acting on themselves as well as for their assigned professional.
 *
 * Reachable today only from `WorkoutPlanScreen`'s empty state, so a member
 * with an active plan normally never lands here -- but the route itself has
 * no such guard (browser history, a stale service-worker-cached link), and
 * without `replacesPlanId` a member who did would draft an entire plan only
 * to have the optimistic-concurrency check reject it at the very last step.
 * Fetching the active plan first closes that gap defensively; it is not, on
 * its own, a "replace my plan" entry point -- that UI decision is still
 * open, tracked in the design spec.
 */
export default function NewPlanScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const activePlan = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  if (activePlan.isPending) return <LoadingState />
  if (activePlan.isError && activePlan.data === undefined) {
    return <ErrorState error={activePlan.error} onRetry={activePlan.refetch} />
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Your plan</Typography>
      {activePlan.data ? (
        <Alert severity="info">
          Your current plan stays in your history. This one replaces it and becomes active as
          soon as you confirm it below.
        </Alert>
      ) : null}
      <CreatePlanFlow
        memberId={user.id}
        replacesPlanId={activePlan.data?.plan.id ?? null}
        // `replace`, so Back leaves the plan rather than reopening the form
        // that just created it.
        onDone={() => navigate('/m/workout', { replace: true })}
        onAbandon={() => navigate('/m/workout', { replace: true })}
      />
    </Stack>
  )
}
