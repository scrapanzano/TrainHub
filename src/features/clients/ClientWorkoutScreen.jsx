import { useState } from 'react'
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, Divider,
  Stack, Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router'
import { fetchClient } from '../../data/clients.js'
import { fetchActivePlan, fetchSession } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import CreatePlanFlow from '../workout/CreatePlanFlow.jsx'
import { isSubscriptionActive } from './subscription.js'
import { todayISO } from '../../lib/format.js'
import { runStatusOf } from '../../lib/week.js'
import { sessionStatusOf } from '../workout/status.js'

/**
 * One session in the plan, openable.
 *
 * The professional could not see inside a session at all: the plan was a flat
 * list of names and counts, while the member had a full session-and-exercise
 * drill-down of the same data. A coach cannot review a plan they cannot read.
 *
 * The exercises are fetched when the row is first opened rather than with the
 * plan. A plan is a handful of sessions and the coach usually wants one of
 * them, so loading every prescription up front would pay for four or five
 * queries to answer one question.
 */
function SessionAccordion({ session, statusLabel }) {
  const [open, setOpen] = useState(false)

  const detail = useQuery({
    queryKey: queryKeys.session(session.id),
    queryFn: () => fetchSession(session.id),
    enabled: open,
  })

  return (
    <Accordion
      expanded={open}
      onChange={(_event, isOpen) => setOpen(isOpen)}
      disableGutters
      square
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        // The rounding lives on the list wrapper below, not on each row: MUI
        // rounds only the first and last of a group, so a per-row radius turned
        // the ends of a long plan into half moons.
        '&::before': { display: 'none' },
        '&.Mui-expanded': { margin: 0 },
        '& + &': { borderTop: 1, borderColor: 'divider' },
      }}
    >
      {/* `.MuiAccordionSummary-content` does not shrink on its own, so `noWrap`
          below had nothing to wrap against and long session names ran past the
          chevron. */}
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{ px: 2, '& .MuiAccordionSummary-content': { minWidth: 0, my: 1.5 } }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" noWrap>{session.name}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {/* Derived from this week's runs, not the stored column: the coach
                wants to know whether the client trained THIS week. */}
            {session.exerciseCount} exercises • {statusLabel}
          </Typography>
        </Box>
      </AccordionSummary>

      <AccordionDetails sx={{ px: 2, pt: 0 }}>
        {detail.isPending ? <LoadingState /> : null}
        {/* `data === undefined` rather than `isError`: offline the persisted
            answer is still worth showing. */}
        {detail.isError && detail.data === undefined ? (
          <ErrorState error={detail.error} onRetry={detail.refetch} />
        ) : null}

        {detail.data ? (
          detail.data.exercises.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              This session has no exercises.
            </Typography>
          ) : (
            <Stack divider={<Divider />}>
              {detail.data.exercises.map((item) => (
                <Stack
                  key={item.id}
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center', py: 1.5 }}
                >
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography noWrap>{item.exercise.name}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {item.exercise.muscle_group}
                      {' • '}{item.target_sets} × {item.target_reps}
                      {item.target_weight === null ? '' : ` • ${item.target_weight} kg`}
                    </Typography>
                  </Box>
                  {item.rest_seconds ? (
                    <Chip size="small" variant="outlined" label={`${item.rest_seconds}s rest`} />
                  ) : null}
                </Stack>
              ))}
            </Stack>
          )
        ) : null}
      </AccordionDetails>
    </Accordion>
  )
}

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
  const membershipActive = isSubscriptionActive(client.data, todayISO())
  const inactiveNotice = (
    <Alert severity="warning">
      {clientName}&rsquo;s membership is not active. Reactivate it on their
      profile before building a plan.
    </Alert>
  )

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
        {membershipActive ? (
          <CreatePlanFlow
            memberId={clientId}
            onDone={() => plan.refetch()}
            onAbandon={() => navigate(`/p/clients/${clientId}`)}
          />
        ) : inactiveNotice}
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
        {membershipActive ? (
          <CreatePlanFlow
            memberId={clientId}
            replacesPlanId={plan.data.plan.id}
            onDone={() => {
              setReplacing(false)
              plan.refetch()
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
        title={plan.data.plan.name}
        subtitle={clientName}
        backTo={`/p/clients/${clientId}`}
        backLabel={`Back to ${clientName}`}
      >
        <Typography color="text.secondary">
          {[plan.data.plan.goal, plan.data.plan.level, `${plan.data.plan.weeks} weeks`]
            .filter(Boolean)
            .join(' • ')}
        </Typography>
      </PageHeader>

      <Stack spacing={2}>
        <Typography variant="h2">Sessions</Typography>

        {sessions.length === 0 ? (
          <EmptyState
            title="No sessions yet"
            description="This plan has no sessions. Replace it to add some."
          />
        ) : (
          // One bordered container around the whole list, rounded once at its
          // own corners -- an empty one would draw a box around nothing.
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: '16px', overflow: 'hidden' }}>
            {sessions.map((session) => (
              <SessionAccordion
                key={session.id}
                session={session}
                statusLabel={
                  sessionStatusOf(runStatusOf(session.runs, plan.data.weekStart).status).label
                }
              />
            ))}
          </Box>
        )}
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
