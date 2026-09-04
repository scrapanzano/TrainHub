import { useState } from 'react'
import { Button, Stack, TextField } from '@mui/material'

/** A number field that keeps '' distinct from 0 while editing. */
function NumberField({ label, value, onChange }) {
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', min: 0 } }}
      fullWidth
    />
  )
}

// '' must not become 0: an empty macro field means "not set", and the
// column is nullable precisely so it can say so.
const toNumberOrNull = (value) => (value === '' || value === null ? null : Number(value))

/**
 * A nutrition plan's metadata: name, calorie target, three macros, notes.
 *
 * Mirrors `PlanForm.jsx`'s role for Workout Plan: owns only its draft, does
 * not write anything itself.
 *
 * @param {object}   props
 * @param {Function} props.onSubmit    `({name, kcalTarget, proteinG, carbsG, fatG, notes}) => void`
 * @param {?object}  props.initial     Values to reopen with, after Back.
 * @param {string}   props.submitLabel Label for the button.
 */
export default function NutritionPlanForm({ onSubmit, initial = null, submitLabel = 'Continue' }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [kcal, setKcal] = useState(initial?.kcalTarget ?? '')
  const [protein, setProtein] = useState(initial?.proteinG ?? '')
  const [carbs, setCarbs] = useState(initial?.carbsG ?? '')
  const [fat, setFat] = useState(initial?.fatG ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  return (
    <Stack
      component="form"
      spacing={3}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({
          name,
          kcalTarget: toNumberOrNull(kcal),
          proteinG: toNumberOrNull(protein),
          carbsG: toNumberOrNull(carbs),
          fatG: toNumberOrNull(fat),
          notes,
        })
      }}
    >
      <TextField
        label="Plan name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Lean Bulk"
        required
        fullWidth
      />
      {/* Fixed widths, as `DayForm` already does for the same four figures.
          Left to `flexWrap` with no width they broke into a ragged two-one-one
          on a phone, and the kcal target -- the one that governs the other
          three -- ended up sharing a row rather than leading them. */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
        <NumberField label="kcal target" value={kcal} onChange={setKcal} width={120} />
        <NumberField label="Protein g" value={protein} onChange={setProtein} width={100} />
        <NumberField label="Carbs g" value={carbs} onChange={setCarbs} width={100} />
        <NumberField label="Fat g" value={fat} onChange={setFat} width={100} />
      </Stack>
      <TextField
        label="Additional notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Hydration, supplements, condiments..."
        multiline
        minRows={2}
        fullWidth
      />

      <Button type="submit" variant="contained" size="large" fullWidth>
        {submitLabel}
      </Button>
    </Stack>
  )
}
