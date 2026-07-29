import { useState } from 'react'
import {
  Alert, Button, Card, CardContent, Divider, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan, fetchExerciseCatalogue } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import SessionForm from '../workout/SessionForm.jsx'
import { sessionStatusOf } from '../workout/status.js'
import { useAuth } from '../auth/useAuth.js'

const LEVELS = ['Beginner', 'Intermediate', 'Advanced']

/** The form shown when the client has no plan at all. */
function NewPlanForm({ onSubmit, pending, paused, error }) {
  const [name, setName] = useState('')
  const [goal, setGoal] = useState('')
  const [level, setLevel] = useState('Beginner')
  const [weeks, setWeeks] = useState(6)

  return (
    <Stack
      component="form"
      spacing={3}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit({ name, goal, level, weeks: Number(weeks) })
      }}
    >
      <TextField
        label="Plan name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Hypertrophy - Phase 1"
        required
        fullWidth
      />
      <TextField
        label="Goal"
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="Hypertrophy"
        fullWidth
      />
      <TextField
        select
        label="Level"
        value={level}
        onChange={(event) => setLevel(event.target.value)}
        fullWidth
      >
        {LEVELS.map((option) => (
          <MenuItem key={option} value={option}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        label="Weeks"
        type="number"
        value={weeks}
        onChange={(event) => setWeeks(event.target.value)}
        slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 52 } }}
        fullWidth
      />

      {paused ? (
        <Alert severity="info">
          You are offline. The plan is saved on your device and will be created when you reconnect.
        </Alert>
      ) : null}
      {error ? (
        <Alert severity="error">{error.message ?? 'The plan could not be created.'}</Alert>
      ) : null}

      <Button type="submit" variant="contained" size="large" fullWidth disabled={pending}>
        {paused ? 'Saved offline' : pending ? 'Creating…' : 'Create plan'}
      </Button>
    </Stack>
  )
}

export default function ClientWorkoutScreen() {
  const { clientId } = useParams()
  const { user } = useAuth()
  const [adding, setAdding] = useState(false)

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

  const createPlan = useMutation({ mutationKey: mutationKeys.createPlan })
  const createSession = useMutation({ mutationKey: mutationKeys.createSession })
  const removeSession = useMutation({ mutationKey: mutationKeys.deleteSession })

  if (plan.isPending || client.isPending) return <LoadingState />
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }

  const clientName = client.data?.full_name ?? 'this client'

  // No plan yet: the only thing to do is create one.  This is the case the
  // member's own builder cannot reach, and the reason this screen exists.
  if (plan.data === null) {
    return (
      <Stack spacing={3} sx={{ p: 2 }}>
        <Typography variant="h1">New plan</Typography>
        <Typography color="text.secondary">
          {clientName} has no workout plan. Create one, then add sessions to it.
        </Typography>
        <NewPlanForm
          pending={createPlan.isPending}
          paused={createPlan.isPending && createPlan.isPaused}
          error={createPlan.error}
          onSubmit={(values) =>
            // Generated here, in the submit handler, not during render: a
            // render-time `crypto.randomUUID()` call would be impure and
            // lint-detected.  It is the idempotency key `createPlan` upserts
            // on, so a retried or replayed submit lands on the same row.
            createPlan.mutate({
              id: crypto.randomUUID(),
              memberId: clientId,
              authorId: user.id,
              ...values,
            })
          }
        />
      </Stack>
    )
  }

  const sessions = plan.data.sessions

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack spacing={0.5}>
        <Typography variant="h1">{plan.data.plan.name}</Typography>
        <Typography color="text.secondary">
          {[plan.data.plan.goal, plan.data.plan.level, `${plan.data.plan.weeks} weeks`]
            .filter(Boolean)
            .join(' • ')}
        </Typography>
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
              <Stack direction="row" spacing={2} alignItems="center">
                <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>
                    {session.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {session.exerciseCount} exercises • {sessionStatusOf(session.status).label}
                  </Typography>
                </Stack>

                <IconButton
                  aria-label={`Delete ${session.name}`}
                  disabled={removeSession.isPending}
                  onClick={() => {
                    // A deletion cascades into the client's logged sets, so it
                    // asks first.  `confirm` rather than a dialog component:
                    // this is one destructive action on one screen, and the
                    // native prompt is already accessible and already blocking.
                    if (
                      window.confirm(
                        `Delete “${session.name}”? Any sets ${clientName} has logged in it are deleted too.`,
                      )
                    ) {
                      removeSession.mutate({ sessionId: session.id })
                    }
                  }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            </CardContent>
          </Card>
        ))}

        {removeSession.isError ? (
          <Alert severity="error">
            {removeSession.error?.message ?? 'The session could not be deleted.'}
          </Alert>
        ) : null}
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
                    planId: plan.data.plan.id,
                    name,
                    position: Math.max(0, ...sessions.map((session) => session.position)) + 1,
                    exercises,
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
        <Button variant="contained" size="large" fullWidth onClick={() => setAdding(true)}>
          Add a session
        </Button>
      )}
    </Stack>
  )
}
