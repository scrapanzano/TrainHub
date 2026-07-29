import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Divider, IconButton, Stack, TextField, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import AddIcon from '@mui/icons-material/Add'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

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

// '' must not become 0: an empty macro field means "not set", and the column is
// nullable precisely so it can say so.
const toNumberOrNull = (value) => (value === '' || value === null ? null : Number(value))

/** The header card: plan name, calorie target, three macros. */
function PlanHeaderForm({ plan, onSave, pending, paused, error }) {
  const [name, setName] = useState(plan?.name ?? '')
  const [kcal, setKcal] = useState(plan?.kcal_target ?? '')
  const [protein, setProtein] = useState(plan?.protein_g ?? '')
  const [carbs, setCarbs] = useState(plan?.carbs_g ?? '')
  const [fat, setFat] = useState(plan?.fat_g ?? '')

  return (
    <Card sx={{ bgcolor: 'task.nutrition', border: 'none' }}>
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault()
            onSave({
              name,
              kcalTarget: toNumberOrNull(kcal),
              proteinG: toNumberOrNull(protein),
              carbsG: toNumberOrNull(carbs),
              fatG: toNumberOrNull(fat),
            })
          }}
        >
          <TextField
            label="Plan name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Summer Shred 2026"
            required
            fullWidth
          />

          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <NumberField label="kcal" value={kcal} onChange={setKcal} width={100} />
            <NumberField label="Protein g" value={protein} onChange={setProtein} width={100} />
            <NumberField label="Carbs g" value={carbs} onChange={setCarbs} width={100} />
            <NumberField label="Fat g" value={fat} onChange={setFat} width={100} />
          </Stack>

          {paused ? (
            <Alert severity="info">
              You are offline. The plan is saved on your device and will sync when you reconnect.
            </Alert>
          ) : null}
          {error ? (
            <Alert severity="error">{error.message ?? 'The plan could not be saved.'}</Alert>
          ) : null}

          <Button type="submit" variant="contained" disabled={pending}>
            {paused ? 'Saved offline' : pending ? 'Saving…' : plan ? 'Save plan' : 'Create plan'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  )
}

/** One editable meal: name, time, calories, and its item rows. */
function MealCard({ meal, onSave, onDelete, pending }) {
  const [name, setName] = useState(meal.name)
  const [time, setTime] = useState(String(meal.time_of_day).slice(0, 5))
  const [kcal, setKcal] = useState(meal.kcal ?? '')
  const [items, setItems] = useState(Array.isArray(meal.items) ? meal.items : [])

  const updateItem = (index, field, value) =>
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    )

  return (
    <Card>
      <CardContent>
        <Stack
          component="form"
          spacing={2}
          onSubmit={(event) => {
            event.preventDefault()
            onSave({
              id: meal.id,
              name,
              timeOfDay: time,
              position: meal.position,
              kcal: toNumberOrNull(kcal),
              // Drop rows the user added and left blank rather than writing
              // empty objects into the member's meal list.
              items: items.filter((item) => item.food?.trim()),
            })
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              label="Meal"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              sx={{ flexGrow: 1 }}
            />
            {/* Native time input: the platform already renders a correct,
                accessible, locale-aware picker on every target device. */}
            <TextField
              label="Time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              required
              sx={{ width: 130 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <NumberField label="kcal" value={kcal} onChange={setKcal} width={100} />

            <IconButton aria-label={`Delete ${meal.name}`} onClick={() => onDelete(meal.id)}>
              <DeleteOutlineIcon />
            </IconButton>
          </Stack>

          <Divider />

          {items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No items yet.
            </Typography>
          ) : null}

          {items.map((item, index) => (
            <Stack key={index} direction="row" spacing={1} alignItems="center">
              <TextField
                label="Food"
                value={item.food ?? ''}
                onChange={(event) => updateItem(index, 'food', event.target.value)}
                sx={{ flexGrow: 1 }}
              />
              <TextField
                label="Quantity"
                value={item.qty ?? ''}
                onChange={(event) => updateItem(index, 'qty', event.target.value)}
                placeholder="80 g"
                sx={{ width: 120 }}
              />
              <IconButton
                aria-label={`Remove ${item.food || 'item'}`}
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
              >
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}

          <Stack direction="row" spacing={1}>
            <Button
              startIcon={<AddIcon />}
              onClick={() => setItems((current) => [...current, { food: '', qty: '' }])}
            >
              Add item
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button type="submit" variant="contained" disabled={pending}>
              Save
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function NutritionPlanEditorScreen() {
  const { clientId } = useParams()
  const { user } = useAuth()

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(clientId),
    queryFn: () => fetchNutritionPlan(clientId),
  })

  const savePlan = useMutation({ mutationKey: mutationKeys.saveNutritionPlan })
  const saveMealMutation = useMutation({ mutationKey: mutationKeys.saveMeal })
  const removeMeal = useMutation({ mutationKey: mutationKeys.deleteMeal })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  const plan = nutrition.data?.plan ?? null
  const meals = nutrition.data?.meals ?? []

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">Nutrition Plan</Typography>
        <Typography color="text.secondary">{client.data?.full_name ?? ''}</Typography>
      </Stack>

      <PlanHeaderForm
        // Remount the form when the plan arrives or is replaced, so the fields
        // pick up the loaded values.  Without a key, useState keeps the initial
        // empty strings for the life of the component.
        key={plan?.id ?? 'new'}
        plan={plan}
        pending={savePlan.isPending}
        paused={savePlan.isPending && savePlan.isPaused}
        error={savePlan.error}
        onSave={(values) =>
          savePlan.mutate({
            // The client owns this id so a replayed write upserts instead of
            // duplicating -- see saveNutritionPlan's doc comment. Generated
            // here, in the submit handler, so it is a fresh value only for an
            // actual new-plan submission and not on every render.
            id: plan?.id ?? crypto.randomUUID(),
            memberId: clientId,
            authorId: user.id,
            ...values,
          })
        }
      />

      {/* Meals belong to a plan, so there is nothing to add them to yet. */}
      {plan === null ? (
        <EmptyState
          title="No plan yet"
          description="Create the plan above, then add the daily meals to it."
        />
      ) : (
        <Stack spacing={2}>
          <Typography variant="h2">Daily Meals</Typography>

          {meals.length === 0 ? (
            <EmptyState title="No meals yet" description="Add the first meal of the day below." />
          ) : null}

          {meals.map((meal) => (
            <MealCard
              key={meal.id}
              meal={meal}
              pending={saveMealMutation.isPending}
              onSave={(values) => saveMealMutation.mutate({ planId: plan.id, ...values })}
              onDelete={(mealId) => {
                if (window.confirm('Delete this meal?')) removeMeal.mutate({ mealId })
              }}
            />
          ))}

          {saveMealMutation.isError ? (
            <Alert severity="error">
              {saveMealMutation.error?.message ?? 'The meal could not be saved.'}
            </Alert>
          ) : null}
          {removeMeal.isError ? (
            <Alert severity="error">
              {removeMeal.error?.message ?? 'The meal could not be deleted.'}
            </Alert>
          ) : null}

          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={saveMealMutation.isPending}
            onClick={() =>
              saveMealMutation.mutate({
                // The client owns this id so a replayed write upserts instead
                // of duplicating -- see saveMeal's doc comment. Generated
                // here, in the click handler, so it is a fresh value only for
                // this one new-meal action.
                id: crypto.randomUUID(),
                planId: plan.id,
                name: 'New meal',
                timeOfDay: '12:00',
                // One past the highest in use, not `length + 1`: `unique
                // (plan_id, position)` rejects a reused one, and counting
                // collides the moment any meal has been deleted.
                position: Math.max(0, ...meals.map((meal) => meal.position)) + 1,
                kcal: null,
                items: [],
              })
            }
          >
            Add a meal
          </Button>
        </Stack>
      )}
    </Stack>
  )
}
