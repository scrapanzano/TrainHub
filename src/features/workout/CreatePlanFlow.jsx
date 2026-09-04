import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
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

  // Leaving the flow is always available, and always confirmed: the draft
  // lives only in this component, so cancelling really does lose everything.
  const [abandoning, setAbandoning] = useState(false)

  let body

  if (step === 'meta') {
    body = (
      <PlanForm
        // Set once the summary exists, so returning here to fix a typo
        // reopens filled in rather than blank.
        initial={meta}
        onSubmit={(values) => {
          setMeta(values)
          // First pass through has no sessions yet, so it continues into
          // drafting one; reopened later from the summary (which already
          // has sessions), it returns there instead of restarting the flow.
          setStep(sessions.length > 0 ? 'summary' : 'session')
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
      <Stack spacing={2}>
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
        {/* Only once there is a summary worth returning to -- drafting the
            very first session has nowhere to go back to yet, and Cancel
            already covers leaving the flow entirely. */}
        {sessions.length > 0 ? (
          <Button
            onClick={() => {
              setEditingIndex(null)
              setStep('summary')
            }}
          >
            Back to summary
          </Button>
        ) : null}
      </Stack>
    )
  } else {
    // step === 'summary'
    body = (
      <PlanSummary
        meta={meta}
        sessions={sessions}
        pending={createPlan.isPending}
        paused={createPlan.isPending && createPlan.isPaused}
        error={createPlan.error}
        onEditMeta={() => setStep('meta')}
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
    <Stack spacing={2}>
      {body}
      <Button onClick={() => setAbandoning(true)} disabled={createPlan.isPending} fullWidth>
        Cancel
      </Button>

      <ConfirmDialog
        open={abandoning}
        title="Discard this plan?"
        description="Nothing entered so far will be saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onCancel={() => setAbandoning(false)}
        onConfirm={() => {
          setAbandoning(false)
          onAbandon()
        }}
      />
    </Stack>
  )
}
