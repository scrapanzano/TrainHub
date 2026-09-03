import { Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { useAuth } from '../auth/useAuth.js'

/** One macro figure. */
function Macro({ label, grams }) {
  return (
    <Stack sx={{ alignItems: 'center', flexGrow: 1 }}>
      <Typography variant="h3" component="p">
        {grams ?? '—'}
        {grams == null ? '' : 'g'}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )
}

export default function MealDetailScreen() {
  const { mealId } = useParams()
  const { user } = useAuth()

  // Reuses the plan query rather than adding a per-meal read: the member
  // came from the plan screen, so this is served from cache and works
  // offline.
  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(user.id),
    queryFn: () => fetchNutritionPlan(user.id),
  })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  const meal = nutrition.data?.days.flatMap((day) => day.meals).find((m) => m.id === mealId)

  // A meal id that is not in the plan means it was deleted (replaced along
  // with the rest of its plan), or the URL was typed. Either way this is an
  // empty state, not a crash.
  if (!meal) {
    return (
      <Stack spacing={2} sx={{ p: 2 }}>
        <PageHeader title="Meal" backTo="/m/nutrition" backLabel="Back to nutrition plan" />
        <EmptyState
          title="Meal not found"
          description="This meal is no longer part of your plan."
        />
      </Stack>
    )
  }

  const items = Array.isArray(meal.items) ? meal.items : []
  const hasMacros = meal.protein_g != null || meal.carbs_g != null || meal.fat_g != null

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title={meal.name}
        subtitle={`${String(meal.time_of_day).slice(0, 5)}${
          meal.kcal == null ? '' : ` • ${meal.kcal} kcal`
        }`}
        backTo="/m/nutrition"
        backLabel="Back to nutrition plan"
      />

      {hasMacros ? (
        <Card>
          <CardContent>
            <Stack direction="row">
              <Macro label="Proteins" grams={meal.protein_g} />
              <Macro label="Carbs" grams={meal.carbs_g} />
              <Macro label="Fats" grams={meal.fat_g} />
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          {items.length === 0 ? (
            <Typography color="text.secondary">
              Your professional has not listed the items for this meal yet.
            </Typography>
          ) : (
            <Stack divider={<Divider />} spacing={1.5}>
              {items.map((item, index) => (
                <Stack key={index} direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
                  <Typography sx={{ flexGrow: 1 }}>{item.food}</Typography>
                  <Typography color="text.secondary">{item.qty}</Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {meal.alternatives ? (
        <Card>
          <CardContent>
            <Typography variant="h3" sx={{ mb: 1 }}>Alternatives</Typography>
            <Typography color="text.secondary">{meal.alternatives}</Typography>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  )
}
