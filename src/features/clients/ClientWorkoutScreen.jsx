import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Divider, IconButton, Stack, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan, fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import CreatePlanFlow from '../workout/CreatePlanFlow.jsx'
import SessionForm from '../workout/SessionForm.jsx'
import { runStatusOf } from '../../lib/week.js'
import { sessionStatusOf } from '../workout/status.js'
import { buildSessionExercisePayloads } from '../workout/contracts.js'

export default function ClientWorkoutScreen() {
  const { clientId } = useParams()
  const [adding, setAdding] = useState(false)
  const [replacing, setReplacing] = useState(false)

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  const catalogue = useQuery({
    queryKey: queryKeys.exerciseCatalogue(),
    queryFn: fetchExerciseCatalogue,
  })

  const createSession = useMutation({ mutationKey: mutationKeys.createSession })

  if (plan.isPending || client.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const clientName = client.data?.full_name ?? 'this client'

  // No plan yet.  The same two-step flow the member uses on themselves: the
  // plan and its first session are written together at the end, so abandoning
  // halfway leaves nothing behind.  That matters more here than it looks --
  // `fetchActivePlan` takes the newest plan, so a plan saved with no sessions
  // would immediately replace whatever the client was following with an empty
  // screen reading "This plan has no sessions".
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
          The current plan stays in the client history. The new one becomes active only when its
          first complete session is saved.
        </Alert>
        <CreatePlanFlow
          memberId={clientId}
          replacesPlanId={plan.data.plan.id}
          onDone={() => {
            setReplacing(false)
            plan.refetch()
          }}
        />
        <Button onClick={() => setReplacing(false)}>Cancel</Button>
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
            description="The plan exists but is empty. Add the first session below."
          />
        ) : null}

        {sessions.map((session) => (
          <Card key={session.id}>
            <CardContent>
              <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>
                    {session.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {/* Derived from this week's runs, not from the stored
                        column: what the coach wants to know is whether the
                        client trained THIS week, which a status frozen at the
                        first ever completion cannot say. */}
                    {session.exerciseCount} exercises •{' '}
                    {sessionStatusOf(runStatusOf(session.runs, plan.data.weekStart).status).label}
                  </Typography>
                </Stack>

                <Button
                  component={Link}
                  to={`/p/clients/${clientId}/workout/session/${session.id}/exercise/new`}
                  size="small"
                >
                  Add exercise
                </Button>
              </Stack>
            </CardContent>
          </Card>
        ))}

      </Stack>

      <Divider />

      {adding ? (
        <Stack spacing={2}>
          <Typography variant="h2">New session</Typography>

          {catalogue.isPending ? <LoadingState /> : null}
          {catalogue.isError && catalogue.data === undefined ? (
            <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />
          ) : null}

          {/* Only mount the form once the catalogue is real: MUI's
              useAutocomplete calls `options.filter()` on open, and an undefined
              `options` throws through to the router's root boundary. */}
          {catalogue.data ? (
            <SessionForm
              catalogue={catalogue.data}
              pending={createSession.isPending}
              paused={createSession.isPending && createSession.isPaused}
              error={createSession.error}
              submitLabel="Add session"
              onSubmit={({ name, exercises }) =>
                createSession.mutate(
                  {
                    id: createUuid(),
                    planId: plan.data.plan.id,
                    name,
                    position: Math.max(0, ...sessions.map((session) => session.position)) + 1,
                    exercises: buildSessionExercisePayloads(exercises),
                  },
                  { onSuccess: () => setAdding(false) },
                )
              }
            />
          ) : null}

          <Button onClick={() => setAdding(false)} disabled={createSession.isPending}>
            Cancel
          </Button>
        </Stack>
      ) : (
        <Stack spacing={1}>
          <Button variant="contained" size="large" fullWidth onClick={() => setAdding(true)}>
            Add a session
          </Button>
          <Button variant="outlined" size="large" fullWidth onClick={() => setReplacing(true)}>
            Create replacement plan
          </Button>
        </Stack>
      )}
    </Stack>
  )
}
