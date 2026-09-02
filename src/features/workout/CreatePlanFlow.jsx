import { useState } from 'react'
import { Button } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PlanForm from './PlanForm.jsx'
import SessionForm from './SessionForm.jsx'
import PlanSummary from './PlanSummary.jsx'
import { buildSessionPayloads } from './contracts.js'

/**
 * Build a plan as a local draft -- meta, then any number of sessions -- and
 * write the whole thing in one atomic call when the member or professional
 * confirms. Nothing reaches the server before that: abandoning at any step
 * discards the draft and leaves an existing plan, if there was one, untouched.
 *
 * Used by both roles. Only `memberId`, `replacesPlanId`, `onDone` and
 * `onAbandon` differ.
 *
 * @param {object}   props
 * @param {string}   props.memberId       Who the plan is for.
 * @param {?string}  props.replacesPlanId The plan this one supersedes, if any.
 * @param {Function} props.onDone         The atomic write succeeded.
 * @param {Function} props.onAbandon      The user confirmed discarding the draft.
 */
export default function CreatePlanFlow({ memberId, replacesPlanId = null, onDone, onAbandon }) {
  const [step, setStep] = useState('meta') // 'meta' | 'session' | 'summary'
  const [meta, setMeta] = useState(null)
  const [sessions, setSessions] = useState([])
  const [editingIndex, setEditingIndex] = useState(null)

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const createPlan = useMutation({ mutationKey: mutationKeys.createPlan })

  const confirmAbandon = () => {
    // `confirm` rather than a dialog component: one destructive action in one
    // flow, already accessible and blocking. Required by the flow's own rule
    // that leaving it is always available but always confirmed.
    if (window.confirm('Discard this plan? Nothing entered so far will be saved.')) {
      onAbandon()
    }
  }

  let body

  if (step === 'meta') {
    body = (
      <PlanForm
        onSubmit={(values) => {
          setMeta(values)
          setStep('session')
        }}
      />
    )
  } else if (catalogue.isPending) {
    body = <LoadingState />
  } else if (catalogue.isError && catalogue.data === undefined) {
    body = <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
  } else if (step === 'session') {
    // Reopening a drafted session from the summary pre-fills the form;
    // adding a new one starts blank.
    const editing = editingIndex !== null ? sessions[editingIndex] : null
    body = (
      <SessionForm
        catalogue={catalogue.data}
        submitLabel={editing ? 'Save changes' : 'Add session'}
        initial={editing}
        onSubmit={({ name, exercises }) => {
          const drafted = { id: editing?.id ?? createUuid(), name, exercises }
          setSessions((current) =>
            editingIndex === null
              ? [...current, drafted]
              : current.map((session, index) => (index === editingIndex ? drafted : session)),
          )
          setEditingIndex(null)
          setStep('summary')
        }}
      />
    )
  } else {
    // step === 'summary'
    body = (
      <PlanSummary
        sessions={sessions}
        pending={createPlan.isPending}
        paused={createPlan.isPending && createPlan.isPaused}
        error={createPlan.error}
        onAddSession={() => {
          setEditingIndex(null)
          setStep('session')
        }}
        onEditSession={(index) => {
          setEditingIndex(index)
          setStep('session')
        }}
        onDeleteSession={(index) =>
          setSessions((current) => current.filter((_, i) => i !== index))
        }
        onConfirm={() => {
          // Generated here, in the handler: `react-hooks/purity` forbids
          // `crypto.randomUUID()` in a render body. It is also the
          // idempotency key the secure operation checks, so a replay returns
          // the same bundle rather than creating a second plan that hides
          // the first.
          createPlan.mutate(
            {
              id: createUuid(),
              memberId,
              replacesPlanId,
              ...meta,
              sessions: buildSessionPayloads(sessions),
            },
            { onSuccess: onDone },
          )
        }}
      />
    )
  }

  return (
    <>
      {body}
      <Button
        onClick={confirmAbandon}
        disabled={createPlan.isPending}
        sx={{ mt: 2 }}
        fullWidth
      >
        Cancel
      </Button>
    </>
  )
}
