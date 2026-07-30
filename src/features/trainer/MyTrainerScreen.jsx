import { Avatar, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router'
import { fetchProfessionals } from '../../data/profile.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function MyTrainerScreen() {
  const { profile } = useAuth()

  // Reuses the professionals list to name the assigned one: it is a handful of
  // rows, already cached by the browse screen, and it avoids a second read.
  const professionals = useQuery({
    queryKey: queryKeys.professionals(),
    queryFn: fetchProfessionals,
    enabled: Boolean(profile?.assigned_pro_id),
  })

  // No professional yet is not an empty state, it is a different screen.
  if (!profile?.assigned_pro_id) return <Navigate to="/m/trainer/browse" replace />

  if (professionals.isPending) return <LoadingState />
  if (professionals.isError && professionals.data === undefined) {
    return <ErrorState error={professionals.error} onRetry={professionals.refetch} />
  }

  const pro = professionals.data.find((p) => p.id === profile.assigned_pro_id)

  return (
    <Stack spacing={3} sx={{ p: 2 }}>
      <Typography variant="h1">Personal Trainer</Typography>

      <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center' }}>
        <Avatar src={pro?.avatar_url ?? undefined} sx={{ width: 112, height: 112 }}>
          {pro?.full_name?.[0] ?? '?'}
        </Avatar>
        <Typography variant="h2" component="p">
          {pro?.full_name ?? 'Your professional'}
        </Typography>
        {pro?.bio ? (
          <Typography color="text.secondary" sx={{ maxWidth: 320 }}>
            {pro.bio}
          </Typography>
        ) : null}
      </Stack>

      <Stack spacing={2}>
        {/* No "Call": there is no phone number in the schema. */}
        <Card>
          <CardActionArea component={Link} to="/m/trainer/chat">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <ChatBubbleOutlineIcon color="primary" />
                <Typography variant="h3" sx={{ flexGrow: 1 }}>
                  Chat
                </Typography>
                <ChevronRightIcon color="primary" />
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>

        <Card>
          <CardActionArea component={Link} to="/m/trainer/appointments">
            <CardContent>
              <Stack direction="row" spacing={2} alignItems="center">
                <CalendarMonthIcon color="primary" />
                <Typography variant="h3" sx={{ flexGrow: 1 }}>
                  View Appointments
                </Typography>
                <ChevronRightIcon color="primary" />
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      </Stack>
    </Stack>
  )
}
