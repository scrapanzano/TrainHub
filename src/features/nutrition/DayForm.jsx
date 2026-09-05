import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, Divider, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { EmptyState } from '../../components/ScreenState.jsx'
import { WEEKDAY_SHORT } from '../../lib/format.js'

// 0 = Sunday .. 6 = Saturday, matching `nutrition_days.weekdays` and
// `Date#getDay()`. Displayed Monday-first for readability; the stored value is
// unaffected by display order. Derived from the shared table rather than
// spelled out again, so the picker and everything that reads a saved day back
// can never disagree about which number is which day.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((value) => ({
  value,
  label: WEEKDAY_SHORT[value],
}))

/** A number field that keeps '' distinct from 0 while editing. */
function NumberField({ label, value, onChange, width }) {
  return (
    <TextField
      label={label}
      type="number"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', min: 0 } }}
      sx={{ width }}
    />
  )
}

// '' must not become 0: an empty macro field means "not set".
const toNumberOrNull = (value) => (value === '' || value === null ? null : Number(value))

/** One meal being drafted inside this day: its fields plus its food items. */
function MealBuilder({ onAdd }) {
  const [name, setName] = useState('')
  const [time, setTime] = useState('12:00')
  const [kcal, setKcal] = useState('')
  const [protein, setProtein] = useState('')
  const [carbs, setCarbs] = useState('')
  const [fat, setFat] = useState('')
  const [alternatives, setAlternatives] = useState('')
  const [items, setItems] = useState([])

  const updateItem = (index, field, value) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, [field]: value } : item)))

  const reset = () => {
    setName('')
    setTime('12:00')
    setKcal('')
    setProtein('')
    setCarbs('')
    setFat('')
    setAlternatives('')
    setItems([])
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h3">Add a meal</Typography>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'minmax(0, 1fr) 130px 100px' },
              gap: 1,
            }}
          >
            <TextField
              label="Meal"
              value={name}
              onChange={(event) => setName(event.target.value)}
              sx={{ gridColumn: { xs: '1 / 3', sm: 'auto' } }}
            />
            {/* Native time input: the platform already renders a correct,
                accessible, locale-aware picker on every target device. */}
            <TextField
              label="Time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <NumberField label="kcal" value={kcal} onChange={setKcal} width="100%" />
          </Box>

          <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
            <NumberField label="Protein g" value={protein} onChange={setProtein} width={100} />
            <NumberField label="Carbs g" value={carbs} onChange={setCarbs} width={100} />
            <NumberField label="Fat g" value={fat} onChange={setFat} width={100} />
          </Stack>

          <TextField
            label="Alternatives"
            value={alternatives}
            onChange={(event) => setAlternatives(event.target.value)}
            placeholder="200g egg whites, 4 crispbreads..."
            multiline
            minRows={2}
            fullWidth
          />

          <Divider />

          {items.map((item, index) => (
            <Box
              key={index}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: 'minmax(0, 1fr) 120px auto' },
                gap: 1,
                alignItems: 'center',
              }}
            >
              <TextField
                label="Food"
                value={item.food ?? ''}
                onChange={(event) => updateItem(index, 'food', event.target.value)}
                sx={{ minWidth: 0 }}
              />
              <TextField
                label="Quantity"
                value={item.qty ?? ''}
                onChange={(event) => updateItem(index, 'qty', event.target.value)}
                placeholder="80 g"
                sx={{ width: '100%', gridColumn: { xs: '1 / 3', sm: 'auto' } }}
              />
              <IconButton
                type="button"
                aria-label={`Remove ${item.food || 'item'}`}
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                sx={{ gridColumn: { xs: '2', sm: 'auto' }, gridRow: { xs: '1', sm: 'auto' } }}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Box>
          ))}

          <Button
            type="button"
            startIcon={<AddIcon />}
            onClick={() => setItems((current) => [...current, { food: '', qty: '' }])}
          >
            Add item
          </Button>

          <Button
            type="button"
            variant="outlined"
            disabled={!name.trim()}
            onClick={() => {
              onAdd({
                name,
                timeOfDay: time,
                kcal: toNumberOrNull(kcal),
                proteinG: toNumberOrNull(protein),
                carbsG: toNumberOrNull(carbs),
                fatG: toNumberOrNull(fat),
                alternatives,
                items,
              })
              reset()
            }}
          >
            Add meal to this day
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

/**
 * Build one day type: a name, which weekdays it covers, and its meals.
 *
 * Meals are drafted locally through `MealBuilder` and only ever appended
 * here -- like `SessionForm.jsx`'s exercises, nothing is written until the
 * whole plan is submitted as part of `CreateNutritionPlanFlow`'s one atomic
 * create.
 *
 * @param {object}   props
 * @param {Function} props.onSubmit         `({name, weekdays, meals}) => void`
 * @param {?object}  props.initial          `{name, weekdays, meals}` to reopen with.
 * @param {string}   props.submitLabel      Idle label for the button.
 * @param {Set<number>} props.takenWeekdays Weekdays already claimed by another
 *   drafted day type -- their chips are disabled here, which is what makes
 *   "a weekday belongs to at most one day type" true (there is no database
 *   constraint for it; see `patches/022`'s comment on `nutrition_days.weekdays`).
 */
export default function DayForm({
  onSubmit, initial = null, submitLabel = 'Save day', takenWeekdays = new Set(),
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [weekdays, setWeekdays] = useState(() => new Set(initial?.weekdays ?? []))
  const [meals, setMeals] = useState(initial?.meals ?? [])

  const toggleWeekday = (value) => {
    setWeekdays((current) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    onSubmit({ name, weekdays: [...weekdays], meals })
  }

  return (
    <Stack component="form" onSubmit={handleSubmit} spacing={3}>
      <TextField
        label="Day name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Day A"
        required
        fullWidth
      />

      <Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Which days of the week is this?
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          {WEEKDAYS.map(({ value, label }) => {
            const taken = takenWeekdays.has(value)
            return (
              <Chip
                key={value}
                label={label}
                color={weekdays.has(value) ? 'primary' : 'default'}
                onClick={taken ? undefined : () => toggleWeekday(value)}
                disabled={taken}
                aria-pressed={weekdays.has(value)}
              />
            )
          })}
        </Stack>
      </Box>

      {weekdays.size === 0 ? (
        <Alert severity="warning">Select at least one weekday for this day type.</Alert>
      ) : null}

      <Divider />

      {meals.length === 0 ? (
        <EmptyState title="No meals yet" description="Add the first meal below." />
      ) : (
        <Stack spacing={2}>
          {meals.map((meal, index) => (
            <Card key={index}>
              <CardContent>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>{meal.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {meal.timeOfDay}
                      {meal.kcal == null ? '' : ` • ${meal.kcal} kcal`}
                    </Typography>
                  </Box>
                  <IconButton
                    type="button"
                    aria-label={`Remove ${meal.name}`}
                    onClick={() => setMeals((current) => current.filter((_, i) => i !== index))}
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <MealBuilder onAdd={(meal) => setMeals((current) => [...current, meal])} />

      {meals.length === 0 ? (
        <Alert severity="warning">A day needs at least one meal before it can be saved.</Alert>
      ) : null}

      <Button
        type="submit"
        variant="contained"
        size="large"
        fullWidth
        disabled={weekdays.size === 0 || meals.length === 0}
      >
        {submitLabel}
      </Button>
    </Stack>
  )
}
