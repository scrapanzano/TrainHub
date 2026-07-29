import { Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchActivePlan, fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import SessionForm from './SessionForm.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function WorkoutBuilderScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const plan = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const create = useMutation({ mutationKey: mutationKeys.createSession })

  if (plan.isPending || catalogue.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }
  // Ungated, `catalogue.data` is undefined and MUI's useAutocomplete calls
  // `options.filter()` the moment the popup opens.  With no errorElement in the
  // route tree that throw replaces the whole app with the root boundary.
  if (catalogue.isError && catalogue.data === undefined) {
    return <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  }
  if (!plan.data) {
    return (
      <EmptyState
        title="No plan to add to"
        description="Your trainer has not assigned you a plan yet. Sessions belong to a plan."
      />
    )
  }

  const onSubmit = ({ name, exercises }) => {
    create.mutate(
      {
        planId: plan.data.plan.id,
        name,
        // One past the highest position in use, not `length + 1`.  The two agree
        // only while positions run contiguously from 1, and `unique (plan_id,
        // position)` rejects a reused one -- so the moment a session is deleted,
        // counting would land on a position still occupied.
        position: Math.max(0, ...plan.data.sessions.map((session) => session.position)) + 1,
        exercises,
      },
      { onSuccess: () => navigate('/m/workout', { replace: true }) },
    )
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">New session</Typography>
      <SessionForm
        catalogue={catalogue.data}
        onSubmit={onSubmit}
        pending={create.isPending}
        paused={create.isPending && create.isPaused}
        error={create.error}
      />
    </Stack>
  )
}
