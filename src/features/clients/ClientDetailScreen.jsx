import { useState } from 'react'
import {
  Alert, Avatar, Box, Button, Card, CardActionArea, CardContent, Chip, Divider,
  LinearProgress, Skeleton, Snackbar, Stack, Typography,
} from '@mui/material'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import EventNoteIcon from '@mui/icons-material/EventNote'
// The bare `ChatBubbleOutline` glyph is not shipped by the installed
// @mui/icons-material@9.2.0 -- only the styled variants are, the same trap
// `DeleteOutline` set in Phase 2. Vite resolves it at build time, not lint time.
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { fetchNutritionPlan } from '../../data/nutrition.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { localDayISO, todayISO } from '../../lib/format.js'
import { runStatusOf } from '../../lib/week.js'
import { planProgress } from '../workout/status.js'
import { workoutWeekSummary } from '../progress/progress.js'
import { daysBetween, membershipAction, subscriptionStateOf } from './subscription.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'

/**
 * One overview card: an icon, a title, a chevron, and whatever the caller shows.
 *
 * `to` is optional. Without it the card is inert -- which is what the empty
 * states need, because they carry a real `Button` and a button nested inside a
 * `CardActionArea` is a button inside a button.
 */
function OverviewCard({ icon, title, to = null, children }) {
  const inner = (
    <CardContent>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
        <Typography variant="h3" sx={{ flexGrow: 1, minWidth: 0 }} noWrap>
          {title}
        </Typography>
        {to ? <ChevronRightIcon color="primary" /> : null}
      </Stack>
      {children ? <Box sx={{ mt: 1.5 }}>{children}</Box> : null}
    </CardContent>
  )

  return (
    <Card>
      {to ? <CardActionArea component={Link} to={to}>{inner}</CardActionArea> : inner}
    </Card>
  )
}

/**
 * What a card shows while its query is in flight.
 *
 * Three cards used to render the literal string "Loading…" in the same grey
 * `body2` as "No plan assigned yet", so for the length of the first fetch the
 * coach read an answer that was not an answer.
 */
function CardLoading() {
  return (
    <>
      <Skeleton variant="text" width="60%" />
      <Skeleton variant="text" width="35%" />
    </>
  )
}

export default function ClientDetailScreen() {
  const { clientId } = useParams()

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
  })

  const nutrition = useQuery({
    queryKey: queryKeys.nutritionPlan(clientId),
    queryFn: () => fetchNutritionPlan(clientId),
  })

  const [feedback, setFeedback] = useState(null)
  const membership = useMutation({ mutationKey: mutationKeys.setSubscriptionStatus })

  if (client.isPending) return <LoadingState />
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }

  const state = subscriptionStateOf(client.data, todayISO())
  const action = membershipAction(state)
  // The mutation pauses offline, so `isPending` stays true with no `onSuccess`.
  // Mirror BookingSheet: show it as saved rather than stuck on "Saving…".
  const savedOffline = membership.isPending && membership.isPaused
  const progress = planProgress(
    (plan.data?.sessions ?? []).map((session) => ({
      status: runStatusOf(session.runs, plan.data.weekStart).status,
    })),
  )
  const weekly = workoutWeekSummary(
    (plan.data?.sessions ?? []).flatMap((session) => session.runs ?? []),
    plan.data?.sessions.length ?? 0,
    todayISO(),
  )

  // `weeks` is the plan's intended length and `created_at` is when it started,
  // so the week the client is in is derived, not stored.  Clamped at both ends:
  // a plan read on its first day is week 1, and one left running past its span
  // must not print "week 11 of 8".  Day granularity (via `todayISO`) rather
  // than `Date.now()`: this only needs to change once a day, and a bare clock
  // read in the render body is impure under StrictMode's double-invoke.
  // `created_at` is a `timestamptz`, serialised in UTC -- `localDayISO` maps it
  // to the viewer's local calendar day before it's compared against
  // `todayISO()`, which is also local. Comparing the raw UTC-sliced string
  // against a local `todayISO()` would misreport the week for the last hour or
  // two of every UTC day.
  const planWeek = plan.data
    ? Math.min(
        plan.data.plan.weeks,
        Math.max(
          1,
          Math.floor(daysBetween(localDayISO(plan.data.plan.created_at), todayISO()) / 7) + 1,
        ),
      )
    : null

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <PageHeader title="Client profile" backTo="/p/clients" backLabel="Back to clients" />

      <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Avatar src={client.data.avatar_url ?? undefined} sx={{ width: 112, height: 112 }}>
          {client.data.full_name?.[0] ?? '?'}
        </Avatar>
        <Typography variant="h1">{client.data.full_name}</Typography>

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ flexWrap: 'wrap', justifyContent: 'center' }}
        >
          {/* `profiles` carries no date of birth, so the wireframe's "Age" pill
              becomes the one date that does exist. */}
          <Chip
            size="small"
            label={`Member since ${String(client.data.created_at).slice(0, 4)}`}
          />
          {plan.data?.plan.goal ? (
            <Chip size="small" label={`Goal: ${plan.data.plan.goal}`} />
          ) : null}
          <Chip
            size="small"
            label={`State: ${state.label}`}
            sx={{ bgcolor: state.color, color: 'common.white' }}
          />
        </Stack>

      </Stack>

      {/* Chat and appointments were the two ways to reach this client that the
          screen did not offer as cards. Chat was a transparent, borderless
          `Card` floating between the membership button and the "Overview"
          heading -- an icon with a word under it, reading as a stray glyph
          rather than the only door to a whole feature. Appointments had no
          screen at all on this side, while the member has had the mirror of it
          since Phase 4A.

          No "Call": there is no phone number in the schema. */}
      <Stack spacing={2}>
        <OverviewCard
          icon={<ChatBubbleOutlineIcon />}
          title="Chat"
          to={`/p/clients/${clientId}/chat`}
        />
        <OverviewCard
          icon={<EventNoteIcon />}
          title="Appointments"
          to={`/p/clients/${clientId}/appointments`}
        />
      </Stack>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Overview
        </Typography>

        <Stack spacing={2}>
          <OverviewCard
            icon={<FitnessCenterIcon />}
            title="Workout Plan"
            to={`/p/clients/${clientId}/workout`}
          >
            {/* `undefined` means not loaded yet; `null` means loaded and there
                is none.  Collapsing them shows "No plan assigned" to every
                client for the length of the first fetch.  The error branch is
                gated on `isError && data === undefined`, never `isError`
                alone: with `networkMode: 'offlineFirst'` a failed refetch
                leaves good cached data in place, and this must keep showing
                it rather than an error. */}
            {plan.isError && plan.data === undefined ? (
              <Typography variant="body2" color="text.secondary">
                {navigator.onLine
                  ? 'Could not load the workout plan. Tap to try again.'
                  : 'You are offline. This will load once you reconnect.'}
              </Typography>
            ) : plan.data === undefined ? (
              <CardLoading />
            ) : plan.data === null ? (
              <Typography variant="body2" color="text.secondary">
                No plan assigned yet. Tap to build one.
              </Typography>
            ) : (
              <Stack spacing={1}>
                <Typography variant="body2">{plan.data.plan.name}</Typography>
                <LinearProgress
                  variant="determinate"
                  value={progress.percent}
                  aria-label={`Plan progress: ${progress.completed} of ${progress.total} sessions completed`}
                />
                {/* aria-hidden because the bar above already announces exactly
                    this, and a reader would otherwise say it twice. */}
                <Typography variant="body2" color="text.secondary" align="center" aria-hidden>
                  Week {planWeek} of {plan.data.plan.weeks}
                </Typography>
              </Stack>
            )}
          </OverviewCard>

          <OverviewCard
            icon={<RestaurantIcon />}
            title="Nutrition Plan"
            to={`/p/clients/${clientId}/nutrition`}
          >
            {nutrition.isError && nutrition.data === undefined ? (
              <Typography variant="body2" color="text.secondary">
                {navigator.onLine
                  ? 'Could not load the nutrition plan. Tap to try again.'
                  : 'You are offline. This will load once you reconnect.'}
              </Typography>
            ) : nutrition.data === undefined ? (
              <CardLoading />
            ) : nutrition.data === null ? (
              <Typography variant="body2" color="text.secondary">
                No nutrition plan yet. Tap to write one.
              </Typography>
            ) : (
              <Stack spacing={1}>
                <Typography variant="h2" component="p">
                  {nutrition.data.plan.kcal_target ?? '—'} kcal
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <Chip size="small" label={`P: ${nutrition.data.plan.protein_g ?? '—'}g`} />
                  <Chip size="small" label={`C: ${nutrition.data.plan.carbs_g ?? '—'}g`} />
                  <Chip size="small" label={`F: ${nutrition.data.plan.fat_g ?? '—'}g`} />
                </Stack>
              </Stack>
            )}
          </OverviewCard>

          <OverviewCard
            icon={<TrendingUpIcon />}
            title="Progress Tracking"
            to={`/p/clients/${clientId}/progress`}
          >
            {plan.isError && plan.data === undefined ? (
              <Typography variant="body2" color="text.secondary">
                Progress is temporarily unavailable.
              </Typography>
            ) : plan.data === undefined ? (
              <CardLoading />
            ) : plan.data === null ? (
              <Typography variant="body2" color="text.secondary">
                Assign a workout plan to start tracking progress.
              </Typography>
            ) : (
              <Stack spacing={0.75}>
                <Typography variant="body2">
                  This week: {weekly.done}/{weekly.total} sessions
                </Typography>
                {weekly.openRun ? (
                  <Typography variant="body2" color="warning.main">
                    {weekly.openRun.session?.name ?? 'Workout'} is currently in progress.
                  </Typography>
                ) : weekly.lastRun ? (
                  <Typography variant="body2" color="text.secondary">
                    Latest: {weekly.lastRun.session?.name ?? 'Workout'} · {weekly.lastRun.pct ?? 0}%
                  </Typography>
                ) : (
                  <Typography variant="body2" color="text.secondary">No workouts recorded yet.</Typography>
                )}
              </Stack>
            )}
          </OverviewCard>
        </Stack>
      </Box>

      {/* Last on the screen, not third. Suspending a membership is rare and
          heavy, and it used to sit above everything the coach actually came
          here to read, right where a thumb lands while scrolling.

          The colour follows the operation rather than the app's accent:
          suspending is destructive, reactivating is its opposite, and between
          them the state is legible before the chip at the top is reached. */}
      {action ? (
        <Stack spacing={1.5}>
          <Divider />
          <Button
            variant={action.nextStatus === 'active' ? 'contained' : 'outlined'}
            color={action.nextStatus === 'active' ? 'success' : 'error'}
            size="large"
            fullWidth
            disabled={membership.isPending}
            onClick={() =>
              membership.mutate(
                { memberId: clientId, status: action.nextStatus },
                {
                  onSuccess: () =>
                    setFeedback(
                      action.nextStatus === 'active'
                        ? 'Membership reactivated.'
                        : 'Membership suspended.',
                    ),
                },
              )
            }
          >
            {savedOffline ? 'Saved offline' : membership.isPending ? 'Saving…' : action.label}
          </Button>
          <Typography variant="body2" color="text.secondary" align="center">
            {action.nextStatus === 'active'
              ? 'Booking, plan changes and points start again straight away.'
              : `${client.data.full_name} keeps their plans but stops booking and earning points.`}
          </Typography>
        </Stack>
      ) : null}

      {savedOffline ? (
        <Alert severity="info">
          You are offline. This change is saved on your device and will be sent when you reconnect.
        </Alert>
      ) : null}
      {membership.isError ? (
        <Alert severity="error">
          {membership.error?.message ?? 'The membership could not be updated.'}
        </Alert>
      ) : null}
      <Snackbar
        open={Boolean(feedback)}
        autoHideDuration={4000}
        onClose={() => setFeedback(null)}
        message={feedback ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Stack>
  )
}
