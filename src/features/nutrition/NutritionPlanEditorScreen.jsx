import { useState } from 'react'
import { Alert, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import CreateNutritionPlanFlow from './CreateNutritionPlanFlow.jsx'
import { isSubscriptionActive } from '../clients/subscription.js'
import { formatTimeOfDay, formatWeekdays, todayISO } from '../../lib/format.js'

export default function NutritionPlanEditorScreen() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [replacing, setReplacing] = useState(false)

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(clientId),
    queryFn: () => fetchNutritionPlan(clientId),
  })

  if (nutrition.isPending || client.isPending) return <LoadingState />
  if (nutrition.isError && nutrition.data === undefined) {
    return <ErrorState error={nutrition.error} onRetry={nutrition.refetch} />
  }
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const clientName = client.data?.full_name ?? 'this client'
  const membershipActive = isSubscriptionActive(client.data, todayISO())
  const inactiveNotice = (
    <Alert severity="warning">
      {clientName}&rsquo;s membership is not active. Reactivate it on their
      profile before writing a plan.
    </Alert>
  )

  // No plan yet. The professional-only wizard: everything is drafted
  // locally and written in one atomic call, so abandoning leaves nothing
  // behind.
  if (nutrition.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <PageHeader
          title="Nutrition Plan"
          subtitle={clientName}
          backTo={`/p/clients/${clientId}`}
          backLabel="Back to client profile"
        />
        <Typography color="text.secondary">{clientName} has no nutrition plan yet.</Typography>
        {membershipActive ? (
          <CreateNutritionPlanFlow
            memberId={clientId}
            onDone={() => nutrition.refetch()}
            onAbandon={() => navigate(`/p/clients/${clientId}`)}
          />
        ) : inactiveNotice}
      </Stack>
    )
  }

  const { plan, days } = nutrition.data

  if (replacing) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <PageHeader
          title="Replace plan"
          subtitle={clientName}
          backTo={`/p/clients/${clientId}`}
          backLabel="Back to client profile"
        />
        <Alert severity="info">
          The current plan stays in the client history. The new one becomes active as soon as
          you confirm it below.
        </Alert>
        {membershipActive ? (
          <CreateNutritionPlanFlow
            memberId={clientId}
            replacesPlanId={plan.id}
            onDone={() => {
              setReplacing(false)
              nutrition.refetch()
            }}
            onAbandon={() => setReplacing(false)}
          />
        ) : inactiveNotice}
      </Stack>
    )
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader
        title="Nutrition Plan"
        subtitle={clientName}
        backTo={`/p/clients/${clientId}`}
        backLabel="Back to client profile"
      />

      <Card sx={{ bgcolor: 'task.nutrition', border: 'none' }}>
        <CardContent>
          <Typography variant="h2">{plan.name}</Typography>
          <Typography color="text.secondary">
            {plan.kcal_target ?? '—'} kcal • {plan.protein_g ?? '—'}P {plan.carbs_g ?? '—'}C{' '}
            {plan.fat_g ?? '—'}F
          </Typography>
          {plan.notes ? (
            <Typography color="text.secondary" sx={{ mt: 1 }}>{plan.notes}</Typography>
          ) : null}
        </CardContent>
      </Card>

      <Stack spacing={2}>
        <Typography variant="h2">Day Types</Typography>

        {days.length === 0 ? (
          <EmptyState
            title="No days yet"
            description="This plan has no day types. Replace it to add some."
          />
        ) : null}

        {days.map((day) => (
          <Card key={day.id}>
            <CardContent>
              <Typography variant="h3" noWrap>{day.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {formatWeekdays(day.weekdays)}
                {' • '}{day.meals.length} meals
              </Typography>

              {/* Meals were a stack of grey `body2` lines reading
                  "Porridge — 07:30 • 480 kcal", which rendered the plan's
                  actual content as if it were metadata about the card. They
                  are the content: a time column, a name, and the figure that
                  is compared between them. */}
              {day.meals.length > 0 ? (
                <Stack divider={<Divider />} sx={{ mt: 1.5 }}>
                  {day.meals.map((meal) => (
                    <Stack
                      key={meal.id}
                      direction="row"
                      spacing={2}
                      sx={{ alignItems: 'baseline', py: 1 }}
                    >
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ width: 44, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatTimeOfDay(meal.time_of_day)}
                      </Typography>
                      <Typography sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
                        {meal.name}
                      </Typography>
                      {meal.kcal == null ? null : (
                        <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {meal.kcal} kcal
                        </Typography>
                      )}
                    </Stack>
                  ))}
                </Stack>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Divider />

      <Button
        variant="outlined"
        size="large"
        fullWidth
        disabled={!membershipActive}
        onClick={() => setReplacing(true)}
      >
        Create replacement plan
      </Button>
      {membershipActive ? null : inactiveNotice}
    </Stack>
  )
}
