import { Box, Card, CardActionArea, CardContent, Chip, IconButton, Stack, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSession } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { setProgress } from './status.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'

export default function SessionDetailScreen() {
  const { sessionId } = useParams()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: () => fetchSession(sessionId),
  })

  if (isPending) return <LoadingState />

  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the answer, and an error
  // screen instead of that answer is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const { session, exercises } = data

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton component={Link} to="/m/workout" aria-label="Back to plan" edge="start">
              <ArrowBackIosNewIcon fontSize="small" />
            </IconButton>

            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="h2" component="h1" noWrap>
                {session.name}
              </Typography>
              <Typography color="text.secondary">{exercises.length} exercises</Typography>
            </Box>

            <IconButton
              component={Link}
              to={`/m/workout/session/${session.id}/live`}
              aria-label="Start session"
              color="primary"
              size="large"
            >
              <PlayArrowIcon fontSize="large" />
            </IconButton>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Typography variant="h2" sx={{ mb: 2 }}>
          Exercises
        </Typography>

        {exercises.length === 0 ? (
          <EmptyState
            title="No exercises yet"
            description="Your trainer has not added any exercises to this session."
          />
        ) : (
          <Stack spacing={2}>
            {exercises.map((item) => {
              const progress = setProgress(item.loggedCount, item.target_sets)

              return (
                <Card key={item.id}>
                  <CardActionArea component={Link} to={`/m/workout/exercise/${item.id}`}>
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

                        <Chip
                          label={progress.label}
                          size="small"
                          color={progress.complete ? 'success' : 'primary'}
                        />
                        <ChevronRightIcon color="primary" />
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Card>
              )
            })}
          </Stack>
        )}
      </Box>
    </Stack>
  )
}
