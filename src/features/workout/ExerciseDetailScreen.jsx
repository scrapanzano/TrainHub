import { Box, Card, CardContent, Chip, IconButton, Stack, Typography } from '@mui/material'
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { fetchSessionExercise } from '../../data/workouts.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { setProgress } from './status.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'

// One prescription line.  Rendered as a definition list so the pairing survives
// for a screen reader instead of collapsing into loose text.  The separator is
// a border rather than a <Divider>: a <dl> may only contain dt/dd groups and
// their wrapping <div>, and an <hr> between them is invalid markup.
function Fact({ label, value }) {
  return (
    <Stack
      direction="row"
      justifyContent="space-between"
      sx={{
        py: 1,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Typography component="dt" color="text.secondary">
        {label}
      </Typography>
      <Typography component="dd" sx={{ m: 0, fontWeight: 600 }}>
        {value}
      </Typography>
    </Stack>
  )
}

export default function ExerciseDetailScreen() {
  const { sessionExerciseId } = useParams()

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.sessionExercise(sessionExerciseId),
    queryFn: () => fetchSessionExercise(sessionExerciseId),
  })

  if (isPending) return <LoadingState />

  // `data === undefined` means it never loaded.  With `offlineFirst` a refetch
  // can fail while the persisted cache still holds the answer, and an error
  // screen instead of that answer is the wrong call in a gym basement.
  if (isError && data === undefined) return <ErrorState error={error} onRetry={refetch} />

  const { exercise, session } = data
  const progress = setProgress(data.loggedCount, data.target_sets)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <IconButton
          component={Link}
          to={`/m/workout/session/${session.id}`}
          aria-label={`Back to ${session.name}`}
          edge="start"
        >
          <ArrowBackIosNewIcon fontSize="small" />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" noWrap>
            {session.name}
          </Typography>
          <Typography variant="h1" noWrap>
            {exercise.name}
          </Typography>
        </Box>
      </Stack>

      {exercise.image_url ? (
        <Box
          component="img"
          src={exercise.image_url}
          alt={`Demonstration of ${exercise.name}`}
          sx={{ width: '100%', borderRadius: 4, display: 'block' }}
        />
      ) : null}

      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Chip label={exercise.muscle_group} />
        {exercise.equipment ? <Chip label={exercise.equipment} variant="outlined" /> : null}
        <Chip label={`${progress.label} sets logged`} color={progress.complete ? 'success' : 'primary'} />
      </Stack>

      <Card>
        <CardContent component="dl" sx={{ m: 0 }}>
          <Fact label="Sets" value={data.target_sets} />
          <Fact label="Reps" value={data.target_reps} />
          {data.target_weight ? <Fact label="Weight" value={`${data.target_weight} kg`} /> : null}
          <Fact label="Rest" value={`${data.rest_seconds}s`} />
        </CardContent>
      </Card>

      {exercise.instructions ? (
        <Box>
          <Typography variant="h2" sx={{ mb: 1 }}>
            How to perform
          </Typography>
          <Typography color="text.secondary">{exercise.instructions}</Typography>
        </Box>
      ) : null}

      {data.notes ? (
        <Box>
          <Typography variant="h2" sx={{ mb: 1 }}>
            Trainer&apos;s note
          </Typography>
          <Typography color="text.secondary">{data.notes}</Typography>
        </Box>
      ) : null}
    </Stack>
  )
}
