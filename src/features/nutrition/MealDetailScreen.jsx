import { Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function MealDetailScreen() {
  const { mealId } = useParams()
  const { user } = useAuth()

  // Reuses the plan query rather than adding a per-meal read: the member came
  // from the plan screen, so this is served from cache and works offline.
  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(user.id),
    queryFn: () => fetchNutritionPlan(user.id),
  })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  const meal = nutrition.data?.meals.find((m) => m.id === mealId)

  // A meal id that is not in the plan means it was deleted, or the URL was
  // typed. Either way this is an empty state, not a crash.
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
    </Stack>
  )
}
