import { useState } from 'react'
import {
  Avatar, Badge, Card, CardActionArea, CardContent, Chip, InputAdornment, Stack, TextField, Typography,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { fetchThreads } from '../../data/chat.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'

export default function ThreadListScreen() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)

  const threads = useQuery({
    queryKey: queryKeys.threads(user.id),
    queryFn: () => fetchThreads(user.id),
    // Polled rather than pushed: the chat's Realtime channel is filtered to one
    // `thread_id` and only exists inside a conversation, so a professional
    // sitting on this inbox would otherwise never see a new message arrive.
    // Covering every thread would need a second, unfiltered channel; an
    // interval is enough at this scale.
    refetchInterval: 60_000,
  })

  const term = search.trim().toLowerCase()
  const visible = (threads.data ?? []).filter((thread) => {
    if (unreadOnly && thread.unreadCount === 0) return false
    if (term === '') return true
    return thread.member?.full_name?.toLowerCase().includes(term)
  })

  const unreadTotal = (threads.data ?? []).reduce((sum, t) => sum + t.unreadCount, 0)

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Typography variant="h1">Chat</Typography>

      <TextField
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search…"
        // A placeholder is not an accessible name: it vanishes as soon as
        // anything is typed and some readers never announce it.
        aria-label="Search conversations"
        fullWidth
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          },
        }}
      />

      <Stack direction="row" spacing={1}>
        <Chip
          label="All"
          color={unreadOnly ? 'default' : 'primary'}
          onClick={() => setUnreadOnly(false)}
          aria-pressed={!unreadOnly}
        />
        <Chip
          label={unreadTotal > 0 ? `To Read ${unreadTotal}` : 'To Read'}
          color={unreadOnly ? 'primary' : 'default'}
          onClick={() => setUnreadOnly(true)}
          aria-pressed={unreadOnly}
        />
      </Stack>

      {threads.isPending ? <LoadingState /> : null}
      {threads.isError && threads.data === undefined ? (
        <ErrorState error={threads.error} onRetry={threads.refetch} />
      ) : null}

      {/* Three different nothings. Telling a professional they have no
          conversations because they filtered to unread would be a lie. */}
      {threads.data?.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="Threads with your clients appear here."
        />
      ) : null}
      {threads.data?.length > 0 && visible.length === 0 ? (
        <EmptyState
          title={unreadOnly ? 'Nothing unread' : 'No match'}
          description={
            unreadOnly
              ? 'Every conversation is up to date.'
              : `No client's name contains "${search.trim()}".`
          }
        />
      ) : null}

      <Stack spacing={2}>
        {visible.map((thread) => (
          <Card key={thread.id}>
            <CardActionArea component={Link} to={`/p/chat/${thread.id}`}>
              <CardContent>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Badge badgeContent={thread.unreadCount} color="primary">
                    <Avatar src={thread.member?.avatar_url ?? undefined}>
                      {thread.member?.full_name?.[0] ?? '?'}
                    </Avatar>
                  </Badge>

                  <Stack sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="h3" noWrap>
                      {thread.member?.full_name ?? 'Unknown client'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {thread.lastMessage?.body ?? 'No messages yet'}
                    </Typography>
                  </Stack>

                  {thread.lastMessage ? (
                    <Typography variant="body2" color="text.secondary">
                      {new Date(thread.lastMessage.created_at).toLocaleTimeString('en-GB', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Typography>
                  ) : null}
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>
    </Stack>
  )
}
