import { useState } from 'react'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PlanForm from './PlanForm.jsx'
import SessionForm from './SessionForm.jsx'
import { buildSessionExercisePayloads } from './contracts.js'

/**
 * Build a plan and its first session, writing one atomic bundle at the end.
 *
 * The writes are deferred to the last step deliberately.  `fetchActivePlan`
 * takes the newest plan by `created_at`, so a plan saved before it has a
 * session would instantly hide whatever came before it -- including one a coach
 * spent an afternoon writing -- while showing the member an empty plan.
 * Nothing is created until there is something worth showing, which also
 * enforces the rule that a session must hold at least one exercise.
 *
 * Patch 015 creates the plan, session and exercises in one transaction. A lost
 * connection therefore leaves either the complete bundle or nothing, and a
 * replay uses the client-generated IDs to return the same rows.
 */
export default function CreatePlanFlow({ memberId, replacesPlanId = null, onDone }) {
  // Step and values are separate state: going Back must return to a filled-in
  // form, not an empty one.  Deriving the step from `meta === null` would clear
  // the plan's name the moment the member went back to check it.
  const [step, setStep] = useState(1)
  const [meta, setMeta] = useState(null)

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const createPlan = useMutation({ mutationKey: mutationKeys.createPlan })

  const pending = createPlan.isPending
  const paused = pending && createPlan.isPaused
  const error = createPlan.error

  if (step === 1) {
    return (
      <PlanForm
        initial={meta}
        submitLabel="Continue"
        onSubmit={(values) => {
          setMeta(values)
          setStep(2)
        }}
      />
    )
  }

  if (catalogue.isPending) return <LoadingState />
  // Ungated, `catalogue.data` is undefined and MUI's useAutocomplete calls
  // `options.filter()` the moment the popup opens.  With no errorElement in the
  // route tree that throw replaces the whole app with the root boundary.
  if (catalogue.isError && catalogue.data === undefined) {
    return <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  }

  const onSubmit = ({ name, exercises }) => {
    // Generated in the handler, not during render: `react-hooks/purity` forbids
    // `createUuid()` in a render body.  It is also the idempotency key
    // the secure operation checks, so a replay returns the same bundle rather
    // than creating a second plan that hides the first.
    createPlan.mutate(
      {
        id: createUuid(),
        memberId,
        replacesPlanId,
        ...meta,
        sessionId: createUuid(),
        sessionName: name,
        exercises: buildSessionExercisePayloads(exercises),
      },
      { onSuccess: onDone },
    )
  }

  return (
    <Stack spacing={3}>
      <Stack spacing={0.5}>
        <Typography variant="h2" component="h2">
          First session
        </Typography>
        <Typography color="text.secondary">
          {meta.name} needs at least one session before it can exist.
        </Typography>
      </Stack>

      <SessionForm
        catalogue={catalogue.data}
        onSubmit={onSubmit}
        pending={pending}
        paused={paused}
        submitLabel="Create plan"
      />

      {error ? (
        <Alert severity="error">{error.message ?? 'The plan could not be created.'}</Alert>
      ) : null}

      <Button onClick={() => setStep(1)} disabled={pending}>
        Back
      </Button>
    </Stack>
  )
}
