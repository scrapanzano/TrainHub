import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, IconButton, LinearProgress, Menu, MenuItem, Stack,
  Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { fetchActivePlan } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { runStatusOf } from '../../lib/week.js'
import { planProgress } from './status.js'
import SessionCard from '../../components/SessionCard.jsx'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

/**
 * The fork a member with no plan is offered.
 *
 * Shown only here, in the empty state.  A permanent banner above an active plan
 * would be noise over the thing the member came to see, and the same two paths
 * stay reachable afterwards from the overflow menu's "Create a new plan".
 */
function NoPlan({ hasCoach }) {
  return (
    <EmptyState
      title="No plan yet"
      description={
        hasCoach
          ? 'Your coach can write one for you after a consultation — or you can build your own.'
          : 'A coach can write one around your goals — or you can build your own.'
      }
      action={
        <Stack spacing={1} sx={{ width: '100%', maxWidth: 320 }}>
          <Button
            component={Link}
            to={hasCoach ? '/m/trainer' : '/m/trainer/browse'}
            variant="contained"
            size="large"
            fullWidth
          >
            {hasCoach ? 'Book a consultation' : 'Choose a coach'}
          </Button>
          <Button component={Link} to="/m/workout/builder" variant="outlined" size="large" fullWidth>
            Build my own
          </Button>
        </Stack>
      }
    />
  )
}

export default function WorkoutPlanScreen() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [editing, setEditing] = useState(false)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.activePlan(user.id),
    queryFn: () => fetchActivePlan(user.id),
  })

  const removeSession = useMutation({ mutationKey: mutationKeys.deleteSession })

  if (isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds a good plan, and an error
  // screen instead of that plan is the wrong answer for an offline gym.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />
  if (!data) return <NoPlan hasCoach={Boolean(profile?.assigned_pro_id)} />

  const { plan, sessions, weekStart } = data
  // Status is derived, never read off the row: `workout_sessions.status` is one
  // column that freezes at the first completion, and a plan repeats weekly.
  const states = sessions.map((session) => runStatusOf(session.runs, weekStart))
  const progress = planProgress(states.map(({ status }) => ({ status })))
  const subtitle = [plan.goal, plan.level].filter(Boolean).join(' - ')
  // A plan is editable by whoever wrote it.  A member may replace a coach's
  // plan wholesale -- that is their call -- but not reach inside it.
  const isAuthor = plan.author?.id === user.id
  // Editing while a workout is open would let the member delete the session
  // they are standing in the middle of.
  const liveHere = states.some(({ status }) => status === 'in_progress')

  const closeMenu = () => setMenuAnchor(null)

  const onDelete = (session) => {
    // `confirm` rather than a dialog component: this is one destructive action
    // and the native prompt is already accessible and already blocking.
    if (
      window.confirm(
        `Delete “${session.name}”? Its ${session.exerciseCount} exercises and every set you have logged in it go too.`,
      )
    ) {
      removeSession.mutate({ sessionId: session.id })
    }
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      {/* No add button up here any more.  "Add a session" belongs to edit mode,
          where the list it changes is visible, and "create a new plan" is a
          replacement rather than an addition and lives in the menu behind a
          warning. */}
      <Typography variant="h1">Workout Plan</Typography>

      <Card>
        <CardContent>
          <Stack direction="row" alignItems="flex-start" spacing={1}>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" component="h3">{plan.name}</Typography>
              {subtitle ? (
                <Typography color="primary">{subtitle}</Typography>
              ) : null}
            </Box>

            {editing ? null : (
              <IconButton
                onClick={(event) => setMenuAnchor(event.currentTarget)}
                aria-label="Plan options"
                edge="end"
              >
                <MoreVertIcon />
              </IconButton>
            )}
          </Stack>

          {/* Two columns on any phone wide enough, stacked below that -- the
              labels are short but "Duration: 6 weeks" still wraps badly at 320px. */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              rowGap: 0.5,
              columnGap: 2,
              mt: 2,
            }}
          >
            <Typography variant="body2">Sessions: {sessions.length}</Typography>
            <Typography variant="body2">Duration: {plan.weeks} weeks</Typography>
            {plan.author ? (
              <Typography variant="body2">Created by: {plan.author.full_name}</Typography>
            ) : null}
          </Box>

          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={progress.percent}
              aria-label={`${progress.completed} of ${progress.total} sessions done this week`}
              sx={{ height: 8, borderRadius: 999 }}
            />
            {/* "This week" is the whole point: the bar empties every Monday. */}
            <Typography variant="body2" color="text.secondary" aria-hidden sx={{ mt: 0.5 }}>
              {progress.completed} of {progress.total} sessions done this week
            </Typography>
          </Box>
        </CardContent>
      </Card>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        <MenuItem
          onClick={() => {
            closeMenu()
            if (
              window.confirm(
                `Creating a new plan replaces “${plan.name}”. It stops being shown, along with its sessions. Continue?`,
              )
            ) {
              navigate('/m/workout/builder')
            }
          }}
        >
          Create a new plan
        </MenuItem>
        {isAuthor ? (
          <MenuItem
            disabled={liveHere}
            onClick={() => {
              closeMenu()
              setEditing(true)
            }}
          >
            Edit plan
          </MenuItem>
        ) : null}
      </Menu>

      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Typography variant="h2">Training Sessions</Typography>
          {editing ? (
            <Button onClick={() => setEditing(false)} disabled={removeSession.isPending}>
              Done
            </Button>
          ) : null}
        </Stack>

        {removeSession.isError ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {removeSession.error?.message ?? 'The session could not be deleted.'}
          </Alert>
        ) : null}

        {sessions.length === 0 ? (
          <EmptyState
            title="This plan has no sessions"
            description="Add the first one to get started."
          />
        ) : (
          <Stack spacing={2}>
            {sessions.map((session, index) => (
              <SessionCard
                key={session.id}
                session={session}
                status={states[index].status}
                run={states[index].run}
                to={`/m/workout/session/${session.id}`}
                onDelete={editing ? () => onDelete(session) : null}
              />
            ))}
          </Stack>
        )}

        {editing ? (
          <Button
            component={Link}
            to="/m/workout/session/new"
            variant="outlined"
            size="large"
            fullWidth
            startIcon={<AddIcon />}
            sx={{ mt: 2 }}
          >
            Add a session
          </Button>
        ) : null}
      </Box>
    </Stack>
  )
}
