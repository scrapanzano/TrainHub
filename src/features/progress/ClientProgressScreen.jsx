import { useState } from 'react'
import {
  Box, Card, CardActionArea, CardContent, Chip, LinearProgress, Stack, Typography,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan } from '../../data/workouts.js'
import { fetchOpenRun, fetchRunsSince } from '../../data/runs.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { formatDate, localDayISO, todayISO } from '../../lib/format.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { formatElapsed } from '../workout/timer.js'
import { runDurationMs, workoutWeekSummary } from './progress.js'

/** Thirty days back, as `'YYYY-MM-DD'`. Wide enough for the week plus context. */
function thirtyDaysAgoISO() {
  const now = new Date()
  const then = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)
  return then.toISOString()
}

const outcomeLabels = {
  completed: 'Completed',
  partial: 'Partial',
  abandoned: 'Abandoned',
}

/** One dot and its count, so the bar above can be read without a legend key. */
function WeekTally({ colour, count, label }) {
  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colour, flexShrink: 0 }} />
      <Typography variant="body2" color="text.secondary">
        {count} {label}
      </Typography>
    </Stack>
  )
}

function WorkoutRunCard({ clientId, run }) {
  const duration = runDurationMs(run)
  const content = (
    <CardContent>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h3" noWrap>
            {run.session?.name ?? 'Workout session'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatDate(localDayISO(run.started_at))}
            {duration === null ? ' · In progress' : ` · ${formatElapsed(duration)}`}
          </Typography>
          {run.note ? (
            <Typography variant="body2" sx={{ mt: 1 }} noWrap>
              &ldquo;{run.note}&rdquo;
            </Typography>
          ) : null}
        </Box>
        <Chip
          size="small"
          color={run.outcome === 'completed' ? 'success' : run.outcome === 'abandoned' ? 'default' : 'warning'}
          label={duration === null ? 'In progress' : `${outcomeLabels[run.outcome] ?? 'Closed'} · ${run.pct ?? 0}%`}
          sx={{ alignSelf: 'flex-start' }}
        />
      </Stack>
    </CardContent>
  )

  return (
    <Card>
      {duration === null ? content : (
        <CardActionArea component={Link} to={`/p/clients/${clientId}/progress/run/${run.id}`}>
          {content}
        </CardActionArea>
      )}
    </Card>
  )
}

/**
 * What the coach needs to know about one client's training.
 *
 * Body and nutrition check-in used to live here too: two stat tiles, a note
 * card, and a form for the coach to type in the client's weight. All of it is
 * gone. It asked the professional to record a measurement the app has no other
 * use for, on the screen meant for reading what the client has been doing, and
 * it was the longest thing here. `save_body_metric_secure` stays in the
 * database, now with nothing calling it.
 */
export default function ClientProgressScreen() {
  const { clientId } = useParams()
  const today = todayISO()
  const [sinceISO] = useState(thirtyDaysAgoISO)

  const client = useQuery({
    queryKey: queryKeys.client(clientId),
    queryFn: () => fetchClient(clientId),
  })

  const plan = useQuery({
    queryKey: queryKeys.activePlan(clientId),
    queryFn: () => fetchActivePlan(clientId),
    refetchInterval: 60_000,
  })

  const training = useQuery({
    queryKey: queryKeys.runsSince(clientId, sinceISO),
    queryFn: () => fetchRunsSince(clientId, sinceISO),
    refetchInterval: 60_000,
  })

  const openRun = useQuery({
    queryKey: queryKeys.openRun(clientId),
    queryFn: () => fetchOpenRun(clientId),
    refetchInterval: 60_000,
  })

  // `plan` must gate the loading state too: while it is still in flight,
  // `workoutWeekSummary` gets `0` for the target, which prints "No plan
  // assigned" -- indistinguishable from a client who genuinely has none.
  if (client.isPending || training.isPending || openRun.isPending || plan.isPending) {
    return <LoadingState />
  }
  if (client.isError && client.data === undefined) {
    return <ErrorState error={client.error} onRetry={client.refetch} />
  }
  if (training.isError && training.data === undefined) {
    return <ErrorState error={training.error} onRetry={training.refetch} />
  }
  if (openRun.isError && openRun.data === undefined) {
    return <ErrorState error={openRun.error} onRetry={openRun.refetch} />
  }
  if (plan.isError && plan.data === undefined) {
    return <ErrorState error={plan.error} onRetry={plan.refetch} />
  }

  const allRuns = openRun.data && !training.data.some((run) => run.id === openRun.data.id)
    ? [openRun.data, ...training.data]
    : training.data
  const week = workoutWeekSummary(allRuns, plan.data?.sessions.length ?? 0, today)
  const recentRuns = allRuns.slice(0, 5)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      {/* No manual refresh control: `plan`, `training` and `openRun` already
          poll every 60s, so the button asked the user to do what the screen
          does on its own -- and it had no pending state, so pressing it looked
          like nothing happened. */}
      <PageHeader
        title="Progress"
        subtitle={client.data.full_name}
        backTo={`/p/clients/${clientId}`}
        backLabel={`Back to ${client.data.full_name}`}
      />

      {/* One number, said once. This card used to state the same count three
          ways -- a counter, a row of dots and a bar -- and the dots were fixed
          at 28px inside a Stack that does not wrap, so a plan of six or more
          sessions pushed them off a narrow screen. The tally under the bar is
          the only part saying something the bar cannot: how the remainder
          splits between started and untouched.

          "This week", not "This Week's Goal": it is the plan's own session
          count, not a target the coach set here. */}
      <Card>
        <CardContent>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
            <Typography variant="h3" sx={{ flexGrow: 1 }}>
              This week
            </Typography>
            {week.total > 0 ? (
              <Typography sx={{ fontWeight: 700 }}>
                {week.done}
                <Typography component="span" color="text.secondary" sx={{ fontWeight: 400 }}>
                  {' / '}
                  {week.total}
                </Typography>
              </Typography>
            ) : null}
          </Stack>

          {week.total === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              No plan assigned, so there is no weekly target yet.
            </Typography>
          ) : (
            <>
              <LinearProgress
                variant="determinate"
                value={week.percent}
                aria-label={`${week.done} of ${week.total} weekly sessions completed`}
                sx={{ height: 9, borderRadius: 999, mt: 2 }}
              />
              {/* aria-hidden: the bar above announces the same split, and a
                  reader would otherwise hear it twice. */}
              <Stack
                direction="row"
                spacing={2}
                useFlexGap
                sx={{ flexWrap: 'wrap', mt: 1.5 }}
                aria-hidden
              >
                <WeekTally colour="primary.main" count={week.completed} label="done" />
                <WeekTally colour="warning.main" count={week.partial} label="partial" />
                <WeekTally colour="action.disabledBackground" count={week.todo} label="to do" />
              </Stack>
            </>
          )}
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Recent workouts
        </Typography>
        {recentRuns.length === 0 ? (
          <EmptyState
            title="No workouts recorded yet"
            description="The client&rsquo;s sessions will appear here after they start training."
          />
        ) : (
          <Stack spacing={1.5}>
            {recentRuns.map((run) => (
              <WorkoutRunCard key={run.id} clientId={clientId} run={run} />
            ))}
          </Stack>
        )}
      </Box>

      {/* Last, because it is the one thing on this screen the coach cannot work
          out from the numbers above -- and the only thing the client wrote
          themselves. */}
      {week.lastRun?.note ? (
        <Card sx={{ borderColor: 'primary.main' }}>
          <CardContent>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'flex-start', sm: 'baseline' } }}
            >
              <Typography variant="h3" sx={{ flexGrow: 1 }}>
                Client&rsquo;s note
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {formatDate(localDayISO(week.lastRun.started_at))}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {week.lastRun.session?.name ?? 'Workout session'}
            </Typography>
            <Typography sx={{ mt: 1, fontStyle: 'italic' }}>
              &ldquo;{week.lastRun.note}&rdquo;
            </Typography>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  )
}
