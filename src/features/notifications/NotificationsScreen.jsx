import { useState } from 'react'
import {
  Box, Button, Card, CardActionArea, CardContent, Checkbox, Chip, IconButton, ListItemButton,
  Menu, MenuItem, Stack, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import ChatBubbleIcon from '@mui/icons-material/ChatBubble'
import EventNoteIcon from '@mui/icons-material/EventNote'
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import NotificationsIcon from '@mui/icons-material/Notifications'
import RestaurantIcon from '@mui/icons-material/Restaurant'
// `DeleteOutline` (the base glyph) is not shipped by @mui/icons-material@9.2.0;
// only the styled variants exist.
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { groupByDay } from '../../lib/dayGroups.js'
import { todayISO } from '../../lib/format.js'
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
 * Each kind of notification, as a glyph and the tint behind it.
 *
 * The four kinds existed only as a grey word at the end of the third line, so
 * every row looked the same and the list had to be read rather than scanned.
 * The tints come from the appointment-kind tokens, which is where this palette
 * already lives.
 */
const TYPE_ICONS = {
  message: { Icon: ChatBubbleIcon, bg: 'task.training' },
  appointment: { Icon: EventNoteIcon, bg: 'task.protocol' },
  workout_plan: { Icon: FitnessCenterIcon, bg: 'task.training' },
  nutrition_plan: { Icon: RestaurantIcon, bg: 'task.nutrition' },
}

function TypeIcon({ type }) {
  const { Icon, bg } = TYPE_ICONS[type] ?? { Icon: NotificationsIcon, bg: 'task.done' }
  return (
    <Box
      aria-hidden
      sx={{
        width: 38, height: 38, borderRadius: 3, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: bg, color: 'text.primary',
      }}
    >
      <Icon fontSize="small" />
    </Box>
  )
}

/**
 * One notification's title, body and time -- shared by both row layouts below.
 *
 * The date is gone from the row: the list is grouped under day headings, so
 * repeating "4 Sep" on every line of the 4th of September said nothing. The
 * kind is gone too, now that the icon carries it -- but it stays in the
 * screen-reader label, which has no icon to look at.
 */
function NotificationText({ item }) {
  const time = new Date(item.created_at).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  })

  return (
    <Box sx={{ flexGrow: 1, minWidth: 0 }}>
      <Typography variant="h3" noWrap sx={{ fontWeight: item.read_at ? 500 : 700 }}>
        {item.title}
      </Typography>
      {item.body ? (
        <Typography variant="body2" color="text.secondary" noWrap>
          {item.body}
        </Typography>
      ) : null}
      <Typography variant="body2" color="text.secondary">
        <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          {TYPE_LABELS[item.type] ?? item.type}{', '}
        </Box>
        {time}
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
  // `{kind, id?, title?}`: one dialog serves all three deletions.
  const [confirming, setConfirming] = useState(null)
  const [menuAnchor, setMenuAnchor] = useState(null)

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
  const unreadCount = all.filter((item) => !item.read_at).length
  // Newest first from the query; `groupByDay` keeps that order.
  const days = groupByDay(visible, (item) => item.created_at, todayISO())

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
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Typography variant="h1" sx={{ flexGrow: 1 }}>Notifications</Typography>
        {/* "Delete all" used to sit on the same row as "Select", at the same
            weight, one tap from wiping the list. Destructive and rare belongs
            behind a menu; frequent and safe stays in the open. */}
        <IconButton
          onClick={(event) => setMenuAnchor(event.currentTarget)}
          aria-label="More actions"
          disabled={all.length === 0}
        >
          <MoreVertIcon />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip
          label="All"
          color={filter === 'all' ? 'primary' : 'default'}
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
        />
        <Chip
          label={unreadCount === 0 ? 'Unread' : `Unread · ${unreadCount}`}
          color={filter === 'unread' ? 'primary' : 'default'}
          onClick={() => setFilter('unread')}
          aria-pressed={filter === 'unread'}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          onClick={() => markAll.mutate({ before: new Date().toISOString() })}
          disabled={unreadCount === 0 || markAll.isPending}
        >
          Mark all read
        </Button>
      </Stack>

      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setSelecting(true)
          }}
        >
          Select
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null)
            setConfirming({ kind: 'all' })
          }}
          sx={{ color: 'error.main' }}
          disabled={deleteAll.isPending}
        >
          Delete all
        </MenuItem>
      </Menu>

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
            onClick={() => setConfirming({ kind: 'selected' })}
          >
            Delete
          </Button>
          <Button onClick={exitSelection}>Cancel</Button>
        </Stack>
      ) : null}

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

      {/* Grouped by day, so "when" is read once per heading instead of being
          restated on every row. Unread carries a tinted card as well as the
          dot: on a phone an 8px dot at the end of a line was the only
          difference between an answered message and a new one. */}
      <Stack spacing={2.5}>
        {days.map((day) => (
          <Stack key={day.key} spacing={1}>
            <Typography variant="overline" color="text.secondary" component="h2">
              {day.label}
            </Typography>

            {day.items.map((item) => (
              <Card
                key={item.id}
                // The brand at 7%, not a task token: those are the saturated
                // appointment-kind fills, and a whole card of one would shout
                // louder than the notification it is marking.
                sx={item.read_at ? undefined : (theme) => ({
                  bgcolor: alpha(theme.palette.primary.main, 0.07),
                  borderColor: alpha(theme.palette.primary.main, 0.25),
                })}
              >
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
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', width: '100%' }}>
                      <Checkbox
                        checked={selectedIds.has(item.id)}
                        // The row's own onClick already toggles selection; this
                        // control is visual state, not a second event source.
                        sx={{ pointerEvents: 'none', p: 0 }}
                        tabIndex={-1}
                      />
                      <TypeIcon type={item.type} />
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
                      sx={{ flexGrow: 1, minWidth: 0 }}
                    >
                      <CardContent>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <TypeIcon type={item.type} />
                          <NotificationText item={item} />
                          {item.read_at ? null : (
                            <Box
                              sx={{
                                width: 8, height: 8, borderRadius: '50%',
                                bgcolor: 'primary.main', flexShrink: 0,
                              }}
                            />
                          )}
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                    <IconButton
                      aria-label={`Delete: ${item.title}`}
                      onClick={() => setConfirming({ kind: 'one', id: item.id, title: item.title })}
                      sx={{ alignSelf: 'center', mr: 0.5 }}
                    >
                      <DeleteOutlineIcon />
                    </IconButton>
                  </Stack>
                )}
              </Card>
            ))}
          </Stack>
        ))}
      </Stack>

      {/* One dialog for all three deletions; `confirming` carries which. */}
      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.kind === 'one'
            ? `Delete ${confirming.title}?`
            : confirming?.kind === 'selected'
              ? `Delete ${selectedIds.size} notification${selectedIds.size === 1 ? '' : 's'}?`
              : 'Delete every notification?'
        }
        description="This cannot be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming.kind === 'one') {
            deleteOne.mutate({ id: confirming.id })
          } else if (confirming.kind === 'selected') {
            deleteSelected.mutate({ ids: [...selectedIds] })
            exitSelection()
          } else {
            deleteAll.mutate({ before: new Date().toISOString() })
          }
          setConfirming(null)
        }}
      />
    </Stack>
  )
}
