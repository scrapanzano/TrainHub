import { useState } from 'react'
import { Button, Stack } from '@mui/material'
import { useMutation } from '@tanstack/react-query'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import NutritionPlanForm from './NutritionPlanForm.jsx'
import DayForm from './DayForm.jsx'
import NutritionPlanSummary from './NutritionPlanSummary.jsx'
import { buildDayPayloads } from './contracts.js'

/**
 * Build a nutrition plan as a local draft -- meta, then any number of day
 * types -- and write the whole thing in one atomic call when the
 * professional confirms. Nothing reaches the server before that.
 *
 * Professional-only: unlike `CreatePlanFlow.jsx` (Workout Plan), there is no
 * member-authored path here -- `doc/nutrition_plan.md` is explicit that a
 * client only ever views a nutrition plan.
 *
 * @param {object}   props
 * @param {string}   props.memberId       Who the plan is for.
 * @param {?string}  props.replacesPlanId The plan this one supersedes, if any.
 * @param {Function} props.onDone         The atomic write succeeded.
 * @param {Function} props.onAbandon      The user confirmed discarding the draft.
 */
export default function CreateNutritionPlanFlow({ memberId, replacesPlanId = null, onDone, onAbandon }) {
  const [step, setStep] = useState('meta') // 'meta' | 'day' | 'summary'
  const [meta, setMeta] = useState(null)
  const [days, setDays] = useState([])
  const [editingIndex, setEditingIndex] = useState(null)

  const createPlan = useMutation({ mutationKey: mutationKeys.createNutritionPlan })

  const confirmAbandon = () => {
    if (window.confirm('Discard this plan? Nothing entered so far will be saved.')) {
      onAbandon()
    }
  }

  let body

  if (step === 'meta') {
    body = (
      <NutritionPlanForm
        // Set once the summary exists, so returning here to fix a typo
        // reopens filled in rather than blank.
        initial={meta}
        onSubmit={(values) => {
          setMeta(values)
          // First pass through has no days yet, so it continues into
          // drafting one; reopened later from the summary (which already
          // has days), it returns there instead of restarting the flow.
          setStep(days.length > 0 ? 'summary' : 'day')
        }}
      />
    )
  } else if (step === 'day') {
    // Reopening a drafted day from the summary pre-fills the form; adding a
    // new one starts blank.
    const editing = editingIndex !== null ? days[editingIndex] : null
    body = (
      <Stack spacing={2}>
        <DayForm
          submitLabel={editing ? 'Save changes' : 'Add day'}
          initial={editing}
          onSubmit={({ name, weekdays, meals }) => {
            const drafted = { id: editing?.id ?? createUuid(), name, weekdays, meals }
            setDays((current) =>
              editingIndex === null
                ? [...current, drafted]
                : current.map((day, index) => (index === editingIndex ? drafted : day)),
            )
            setEditingIndex(null)
            setStep('summary')
          }}
        />
        {/* Only once there is a summary worth returning to -- drafting the
            very first day has nowhere to go back to yet, and Cancel already
            covers leaving the flow entirely. */}
        {days.length > 0 ? (
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
      <NutritionPlanSummary
        meta={meta}
        days={days}
        pending={createPlan.isPending}
        paused={createPlan.isPending && createPlan.isPaused}
        error={createPlan.error}
        onEditMeta={() => setStep('meta')}
        onAddDay={() => {
          setEditingIndex(null)
          setStep('day')
        }}
        onEditDay={(index) => {
          setEditingIndex(index)
          setStep('day')
        }}
        onDeleteDay={(index) => setDays((current) => current.filter((_, i) => i !== index))}
        onConfirm={() => {
          // Generated here, in the handler: `react-hooks/purity` forbids
          // `crypto.randomUUID()` in a render body. It is also the
          // idempotency key the secure operation checks, so a replay
          // returns the same bundle rather than creating a second plan
          // that hides the first.
          createPlan.mutate(
            {
              id: createUuid(),
              memberId,
              replacesPlanId,
              ...meta,
              days: buildDayPayloads(days),
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
      <Button onClick={confirmAbandon} disabled={createPlan.isPending} fullWidth>
        Cancel
      </Button>
    </Stack>
  )
}
