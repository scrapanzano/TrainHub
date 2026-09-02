import { useState } from 'react'
import { Box, Button, Card, CardActionArea, CardContent, Divider, Stack, Typography } from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { todayISO } from '../../lib/format.js'
import { weekStrip } from '../calendar/month.js'
import WeekStrip from '../../components/WeekStrip.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/** One macro figure under the calorie target. */
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

export default function MemberNutritionScreen() {
  const { user } = useAuth()
  // Decorative: `meals` is a daily template with no date column, so every day
  // shows the same plan. The strip is drawn because the wireframe draws it; the
  // selection deliberately drives nothing rather than pretending to filter.
  const [selected, setSelected] = useState(todayISO())

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(user.id),
    queryFn: () => fetchNutritionPlan(user.id),
  })

  if (nutrition.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }

  // `undefined` means not loaded; `null` means loaded and there is none. This
  // branch is the wireframe 03B, not a footnote.
  if (nutrition.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">Nutrition Plan</Typography>
        <Card>
          <CardContent>
            <Stack spacing={1} sx={{ alignItems: 'center', textAlign: 'center' }}>
              <Typography variant="h3" color="primary">
                You do not have a nutrition plan yet
              </Typography>
              <Typography color="text.secondary">
                Book an appointment with your professional and start your nutrition journey.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
        <Button
          component={Link}
          to="/m/trainer/appointments"
          variant="contained"
          size="large"
          fullWidth
        >
          Book Appointment
        </Button>
      </Stack>
    )
  }

  const { plan, meals } = nutrition.data

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Nutrition Plan</Typography>

      <Card sx={{ bgcolor: 'task.nutrition', border: 'none' }}>
        <CardContent>
          <Stack spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h2" component="p">
              {plan.name}
            </Typography>
            <Typography variant="h2" component="p">
              {plan.kcal_target ?? '—'} kcal
            </Typography>
            <Divider flexItem />
            <Stack direction="row" sx={{ width: '100%', pt: 1 }}>
              <Macro label="Proteins" grams={plan.protein_g} />
              <Macro label="Carbs" grams={plan.carbs_g} />
              <Macro label="Fats" grams={plan.fat_g} />
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Your Week
        </Typography>
        <WeekStrip days={weekStrip(selected)} selected={selected} onSelect={setSelected} />
      </Box>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Daily Meals
        </Typography>

        {meals.length === 0 ? (
          <EmptyState
            title="No meals added yet"
            description="Your professional has created the plan but has not added its meals yet."
          />
        ) : (
          <Stack spacing={2}>
            {meals.map((meal) => (
            <Card key={meal.id}>
              <CardActionArea component={Link} to={`/m/nutrition/meal/${meal.id}`}>
                <CardContent>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                      <Typography variant="h3" noWrap>
                        {meal.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {String(meal.time_of_day).slice(0, 5)}
                        {meal.kcal == null ? '' : ` • ${meal.kcal} kcal`}
                      </Typography>
                    </Stack>
                    <ChevronRightIcon color="primary" />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
