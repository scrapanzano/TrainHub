import { Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { fetchNotifications } from '../../data/notifications.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

const TYPE_LABELS = {
  message: 'Message',
  appointment: 'Appointment',
  workout_plan: 'Workout plan',
  nutrition_plan: 'Nutrition plan',
}

/**
 * Every notification for the signed-in user, newest first. Shared by both
 * roles -- RLS already scopes the underlying table to the caller, and the
 * rendering (title, body, type, tap-to-open) is identical either way,
 * exactly like `ProfileScreen.jsx`/`SettingsScreen.jsx` already are.
 *
 * Opening this screen does not mark anything read on its own: a notification
 * clears only once its own target is actually visited, whether that visit
 * started here or somewhere else entirely.
 */
export default function NotificationsScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const notifications = useQuery({
    queryKey: queryKeys.notifications(user.id),
    queryFn: () => fetchNotifications(user.id),
  })

  const markRead = useMutation({ mutationKey: mutationKeys.markNotificationRead })

  if (notifications.isPending) return <LoadingState />
  // `data === undefined` means it never loaded. A refetch can fail while the
  // persisted cache still holds a good list; an error screen over usable
  // data would be the wrong answer for an offline gym.
  if (notifications.isError && notifications.data === undefined) {
    return <ErrorState error={notifications.error} onRetry={notifications.refetch} />
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h1">Notifications</Typography>

      {notifications.data.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="New messages, appointments and plans show up here."
        />
      ) : null}

      <Stack spacing={2}>
        {notifications.data.map((item) => (
          <Card key={item.id}>
            <CardActionArea
              onClick={() => {
                if (!item.read_at) markRead.mutate({ id: item.id })
                navigate(item.url)
              }}
            >
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography
                      variant="h3"
                      noWrap
                      sx={{ fontWeight: item.read_at ? 400 : 700 }}
                    >
                      {item.title}
                    </Typography>
                    {item.body ? (
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {item.body}
                      </Typography>
                    ) : null}
                    <Typography variant="body2" color="text.secondary">
                      {TYPE_LABELS[item.type] ?? item.type} ·{' '}
                      {new Date(item.created_at).toLocaleString('en-GB', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                      })}
                    </Typography>
                  </Stack>
                  {item.read_at ? null : (
                    <Stack
                      sx={{
                        width: 8, height: 8, borderRadius: '50%',
                        bgcolor: 'primary.main', mt: 0.75, flexShrink: 0,
                      }}
                    />
                  )}
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
