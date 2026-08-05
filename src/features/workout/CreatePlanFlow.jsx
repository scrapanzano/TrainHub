import { useState } from 'react'
import { Alert, Button, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PlanForm from './PlanForm.jsx'
import SessionForm from './SessionForm.jsx'

/**
 * Build a plan and its first session, in that order, writing both at the end.
 *
 * The writes are deferred to the last step deliberately.  `fetchActivePlan`
 * takes the newest plan by `created_at`, so a plan saved before it has a
 * session would instantly hide whatever came before it -- including one a coach
 * spent an afternoon writing -- while showing the member an empty plan.
 * Nothing is created until there is something worth showing, which also
 * enforces the rule that a session must hold at least one exercise.
 *
 * Both writes are fired together rather than chained through `onSuccess`.
 * Per-call callbacks are not persisted: offline, a chained pair would queue the
 * plan, and if the member closed the app before reconnecting, the replay would
 * create the plan with no callback left to create its session -- an empty plan,
 * which is the exact state this flow exists to prevent.  Fired together, both
 * are durable, and the `planWrite` scope they share in `src/data/mutations.js`
 * replays them in order so the session never lands before its plan.
 *
 * Used by both roles.  Only `memberId`, `authorId` and `onDone` differ.
 */
export default function CreatePlanFlow({ memberId, authorId, onDone }) {
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
  const createSession = useMutation({ mutationKey: mutationKeys.createSession })

  const pending = createPlan.isPending || createSession.isPending
  const paused = pending && (createPlan.isPaused || createSession.isPaused)
  const error = createPlan.error ?? createSession.error

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
    // `crypto.randomUUID()` in a render body.  It is also the idempotency key
    // `createPlan` upserts on, so a replayed submit lands on the same row
    // rather than creating a second plan that hides the first.
    const planId = crypto.randomUUID()

    createPlan.mutate({ id: planId, memberId, authorId, ...meta })
    createSession.mutate(
      // First session of a brand new plan, so position 1 is not a count.
      { planId, name, position: 1, exercises },
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
