import { useState } from 'react'
import {
  Box, Button, Card, CardActionArea, CardContent, Checkbox, Chip, IconButton, ListItemButton,
  Stack, Typography,
} from '@mui/material'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
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

/** One notification's title/body/type/time -- shared by both row layouts below. */
function NotificationText({ item }) {
  return (
    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
      <Typography variant="h3" noWrap sx={{ fontWeight: item.read_at ? 400 : 700 }}>
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
    </Box>
  )
}

/**
 * Every notification for the signed-in user, newest first. Shared by both
 * roles -- RLS already scopes the underlying table to the caller, and the
 * rendering is identical either way, exactly like `ProfileScreen.jsx`/
 * `SettingsScreen.jsx` already are.
 *
 * Opening a notification (outside selection mode) marks it read and
 * navigates -- it does not delete it. Deleting is always a separate,
 * explicit action: the per-row bin icon, a selection, or Delete all.
 */
export default function NotificationsScreen() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all') // 'all' | 'unread'
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const notifications = useQuery({
    queryKey: queryKeys.notifications(user.id),
    queryFn: () => fetchNotifications(user.id),
  })

  const markRead = useMutation({ mutationKey: mutationKeys.markNotificationRead })
  const deleteOne = useMutation({ mutationKey: mutationKeys.deleteNotification })
  const markSelected = useMutation({ mutationKey: mutationKeys.markNotificationsReadByIds })
  const deleteSelected = useMutation({ mutationKey: mutationKeys.deleteNotificationsByIds })
  const markAll = useMutation({ mutationKey: mutationKeys.markAllNotificationsRead })
  const deleteAll = useMutation({ mutationKey: mutationKeys.deleteAllNotifications })

  if (notifications.isPending) return <LoadingState />
  // `data === undefined` means it never loaded. A refetch can fail while the
  // persisted cache still holds a good list; an error screen over usable
  // data would be the wrong answer for an offline gym.
  if (notifications.isError && notifications.data === undefined) {
    return <ErrorState error={notifications.error} onRetry={notifications.refetch} />
  }

  const all = notifications.data
  const visible = filter === 'unread' ? all.filter((item) => !item.read_at) : all

  const exitSelection = () => {
    setSelecting(false)
    setSelectedIds(new Set())
  }

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((item) => selectedIds.has(item.id))
  const toggleSelectAllVisible = () => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(visible.map((item) => item.id)))
  }

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h1">Notifications</Typography>

      <Stack direction="row" spacing={1}>
        <Chip
          label="All"
          color={filter === 'all' ? 'primary' : 'default'}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        />
        <Chip
          label="Unread"
          color={filter === 'unread' ? 'primary' : 'default'}
          onClick={() => setFilter('unread')}
          aria-pressed={filter === 'unread'}
        />
      </Stack>

      {selecting ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography sx={{ flexGrow: 1 }}>{selectedIds.size} selected</Typography>
          <Button onClick={toggleSelectAllVisible} disabled={visible.length === 0}>
            {allVisibleSelected ? 'Deselect all' : 'Select all'}
          </Button>
          <Button
            disabled={selectedIds.size === 0 || markSelected.isPending}
            onClick={() => {
              markSelected.mutate({ ids: [...selectedIds] })
              exitSelection()
            }}
          >
            Mark read
          </Button>
          <Button
            color="error"
            disabled={selectedIds.size === 0 || deleteSelected.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${selectedIds.size} notification${selectedIds.size === 1 ? '' : 's'}?`,
                )
              ) {
                deleteSelected.mutate({ ids: [...selectedIds] })
                exitSelection()
              }
            }}
          >
            Delete
          </Button>
          <Button onClick={exitSelection}>Cancel</Button>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1}>
          <Button onClick={() => setSelecting(true)} disabled={all.length === 0}>
            Select
          </Button>
          <Button
            onClick={() => markAll.mutate({ before: new Date().toISOString() })}
            disabled={all.length === 0 || markAll.isPending}
          >
            Mark all read
          </Button>
          <Button
            color="error"
            disabled={all.length === 0 || deleteAll.isPending}
            onClick={() => {
              if (window.confirm('Delete every notification? This cannot be undone.')) {
                deleteAll.mutate({ before: new Date().toISOString() })
              }
            }}
          >
            Delete all
          </Button>
        </Stack>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={filter === 'unread' ? 'Nothing unread' : 'Nothing yet'}
          description={
            filter === 'unread'
              ? 'Every notification is up to date.'
              : 'New messages, appointments and plans show up here.'
          }
        />
      ) : null}

      <Stack spacing={2}>
        {visible.map((item) => (
          <Card key={item.id}>
            {selecting ? (
              // `ListItemButton`, not `CardActionArea`: the row also
              // contains a `Checkbox`, and nesting one interactive control
              // inside another is invalid here for the same reason a
              // `CardActionArea` never wraps the delete `IconButton` below.
              // `ListItemButton` keeps the row keyboard-focusable, unlike a
              // plain `Box` with an onClick would be.
              <ListItemButton
                onClick={() => toggleSelected(item.id)}
                // `ListItemButton` renders `role="button"`, which hides the
                // inert checkbox from assistive tech (ARIA's presentational-
                // children rule) -- this is what lets a screen reader hear
                // whether the row is selected.
                aria-pressed={selectedIds.has(item.id)}
                sx={{ p: 2 }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    // The row's own onClick already toggles selection; this
                    // control is visual state, not a second event source.
                    sx={{ pointerEvents: 'none', p: 0 }}
                    tabIndex={-1}
                  />
                  <NotificationText item={item} />
                </Stack>
              </ListItemButton>
            ) : (
              <Stack direction="row" sx={{ alignItems: 'stretch' }}>
                <CardActionArea
                  onClick={() => {
                    if (!item.read_at) markRead.mutate({ id: item.id })
                    navigate(item.url)
                  }}
                  sx={{ flexGrow: 1 }}
                >
                  <CardContent>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                      <NotificationText item={item} />
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
                <IconButton
                  aria-label={`Delete: ${item.title}`}
                  onClick={() => {
                    if (window.confirm(`Delete "${item.title}"?`)) {
                      deleteOne.mutate({ id: item.id })
                    }
                  }}
                  sx={{ alignSelf: 'center', mr: 1 }}
                >
                  <DeleteOutlineIcon />
                </IconButton>
              </Stack>
            )}
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
