import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Divider, IconButton, Stack, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import CreatePlanFlow from '../workout/CreatePlanFlow.jsx'
import { runStatusOf } from '../../lib/week.js'
import { sessionStatusOf } from '../workout/status.js'

export default function ClientWorkoutScreen() {
  const { clientId } = useParams()
  const navigate = useNavigate()
  const [replacing, setReplacing] = useState(false)

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  if (plan.isPending || client.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const clientName = client.data?.full_name ?? 'this client'

  // No plan yet. Same wizard the member uses on themselves: everything is
  // drafted locally and written in one atomic call, so abandoning leaves
  // nothing behind.
  if (plan.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">New plan</Typography>
        <Typography color="text.secondary">
          {clientName} has no workout plan yet.
        </Typography>
        <CreatePlanFlow
          memberId={clientId}
          onDone={() => plan.refetch()}
          onAbandon={() => navigate(`/p/clients/${clientId}`)}
        />
      </Stack>
    )
  }

  const sessions = plan.data.sessions

  if (replacing) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">Replace plan</Typography>
        <Alert severity="info">
          The current plan stays in the client history. The new one becomes active as soon as
          you confirm it below.
        </Alert>
        <CreatePlanFlow
          memberId={clientId}
          replacesPlanId={plan.data.plan.id}
          onDone={() => {
            setReplacing(false)
            plan.refetch()
          }}
          onAbandon={() => setReplacing(false)}
        />
      </Stack>
    )
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton
          component={Link}
          to={`/p/clients/${clientId}`}
          aria-label={`Back to ${clientName}`}
          edge="start"
        >
          <ArrowBackIcon />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h1" noWrap>{plan.data.plan.name}</Typography>
          <Typography color="text.secondary" noWrap>{clientName}</Typography>
          <Typography color="text.secondary">
            {[plan.data.plan.goal, plan.data.plan.level, `${plan.data.plan.weeks} weeks`]
              .filter(Boolean)
              .join(' • ')}
          </Typography>
        </Box>
      </Stack>

      <Stack spacing={2}>
        <Typography variant="h2">Sessions</Typography>

        {sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="This plan has no sessions. Replace it to add some."
          />
        ) : null}

        {sessions.map((session) => (
          <Card key={session.id}>
            <CardContent>
              <Typography variant="h3" noWrap>{session.name}</Typography>
              <Typography variant="body2" color="text.secondary" noWrap>
                {/* Derived from this week's runs, not the stored column: the
                    coach wants to know whether the client trained THIS week. */}
                {session.exerciseCount} exercises •{' '}
                {sessionStatusOf(runStatusOf(session.runs, plan.data.weekStart).status).label}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>

      <Divider />

      <Button variant="outlined" size="large" fullWidth onClick={() => setReplacing(true)}>
        Create replacement plan
      </Button>
    </Stack>
  )
}
