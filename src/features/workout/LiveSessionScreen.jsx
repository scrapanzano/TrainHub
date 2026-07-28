import { useState } from 'react'
import {
  Box, Card, CardActionArea, CardContent, Chip, IconButton, Stack, Typography,
} from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import PauseIcon from '@mui/icons-material/Pause'
import StopIcon from '@mui/icons-material/Stop'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { fetchSession } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { formatElapsed } from './timer.js'
import { setProgress } from './status.js'
import { useLiveSession } from './useLiveSession.js'
import LogSetSheet from './LogSetSheet.jsx'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

export default function LiveSessionScreen() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const live = useLiveSession(sessionId)
  const [openExerciseId, setOpenExerciseId] = useState(null)

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  const setStatus = useMutation({ mutationKey: mutationKeys.setSessionStatus })

  if (isPending) return <LoadingState />
  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the session, and an error
  // screen instead of the workout is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const { session, exercises } = data
  const remaining = exercises.filter(
    (item) => !setProgress(item.loggedCount, item.target_sets).complete,
  ).length
  const openExercise = exercises.find((item) => item.id === openExerciseId) ?? null
  // The first unfinished exercise is the one being worked on.
  const currentId = exercises.find(
    (item) => !setProgress(item.loggedCount, item.target_sets).complete,
  )?.id

  const onStart = () => {
    live.start()
    setStatus.mutate({ sessionId, status: 'in_progress' })
  }

  const onStop = () => {
    setStatus.mutate({ sessionId, status: 'completed' })
    live.clear()
    navigate(`/m/workout/session/${sessionId}/summary`, { replace: true })
  }

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Card sx={{ position: 'sticky', top: 0, zIndex: 1 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton
              component={Link}
              to={`/m/workout/session/${sessionId}`}
              aria-label="Back to session"
              edge="start"
            >
              <ArrowBackIosNewIcon fontSize="small" />
            </IconButton>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" component="h1" noWrap>
                {session.name}
              </Typography>
              <Typography color="text.secondary">{exercises.length} exercises</Typography>
              <Typography color="primary" sx={{ fontWeight: 700 }}>
                {!live.started
                  ? 'GET READY'
                  : live.paused
                    ? 'PAUSED'
                    : remaining === 0
                      ? 'ALL DONE'
                      : `${remaining}/${exercises.length} to go`}
              </Typography>
            </Box>

            <Stack direction="row" spacing={0.5} alignItems="center">
              {!live.started ? (
                <IconButton onClick={onStart} aria-label="Start session" color="primary" size="large">
                  <PlayArrowIcon fontSize="large" />
                </IconButton>
              ) : (
                <>
                  <IconButton
                    onClick={live.paused ? live.resume : live.pause}
                    aria-label={live.paused ? 'Resume session' : 'Pause session'}
                    color="primary"
                  >
                    {live.paused ? <PlayArrowIcon /> : <PauseIcon />}
                  </IconButton>
                  <IconButton onClick={onStop} aria-label="Finish session" color="primary">
                    <StopIcon />
                  </IconButton>
                </>
              )}
            </Stack>
          </Stack>

          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ justifyContent: 'flex-end' }}>
            <AccessTimeIcon fontSize="small" color="primary" aria-hidden />
            {/* No aria-label: Typography renders a <p>, whose `generic` role
                prohibits name-from-author, so the label is dropped by several
                screen readers.  The visible text is the accessible content. */}
            <Typography>
              {formatElapsed(live.elapsed)}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Exercises
        </Typography>

        <Stack spacing={2}>
          {exercises.map((item) => {
            const progress = setProgress(item.loggedCount, item.target_sets)
            const isCurrent = item.id === currentId && live.started && !live.paused

            return (
              <Card
                key={item.id}
                sx={{
                  // The wireframe outlines the exercise in progress and fades
                  // the finished ones.  Opacity alone would carry that by sight
                  // only, so the tick and the pill say it too.
                  borderColor: isCurrent ? 'primary.main' : 'divider',
                  borderWidth: isCurrent ? 2 : 1,
                  opacity: progress.complete ? 0.6 : 1,
                }}
              >
                <CardActionArea
                  onClick={() => setOpenExerciseId(item.id)}
                  disabled={!live.started || live.paused}
                >
                  <CardContent>
                    <Stack direction="row" spacing={2} alignItems="center">
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="h3" noWrap>
                          {item.exercise.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" noWrap>
                          {item.exercise.muscle_group}
                        </Typography>
                        <Typography variant="body2" sx={{ mt: 0.5 }}>
                          {item.target_sets} sets • {item.target_reps} reps
                        </Typography>
                      </Box>

                      {progress.complete ? (
                        <CheckCircleIcon color="success" titleAccess="Completed" />
                      ) : (
                        <Chip label={progress.label} size="small" color="primary" />
                      )}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            )
          })}
        </Stack>
      </Box>

      <LogSetSheet
        open={openExercise !== null}
        onClose={() => setOpenExerciseId(null)}
        exercise={openExercise}
        sessionId={sessionId}
      />
    </Stack>
  )
}
