import { useEffect, useRef } from 'react'
import { Avatar, Box, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { ensureThread, fetchMemberThread } from '../../data/chat.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import { useAuth } from '../auth/useAuth.js'
import MessageBubble from './MessageBubble.jsx'
import MessageComposer from './MessageComposer.jsx'
import { useThreadMessages } from './useThreadMessages.js'

/**
 * One conversation.
 *
 * Serves both roles. A member has exactly one thread — with their assigned
 * professional — so theirs is looked up by member id and created on first use;
 * a professional arrives from the inbox with the thread id already in the URL.
 */
export default function ThreadScreen() {
  const { threadId: threadIdParam } = useParams()
  const { user, profile } = useAuth()
  const isMember = profile?.role === 'member'

  // Only the member needs the lookup; the professional already has the id.
  const memberThread = useQuery({
    queryKey: queryKeys.memberThread(user.id),
    queryFn: () => fetchMemberThread(user.id),
    enabled: isMember,
  })

  const threadId = isMember ? (memberThread.data?.id ?? null) : threadIdParam

  const messages = useThreadMessages(threadId)
  const send = useMutation({ mutationKey: mutationKeys.sendMessage })
  const markRead = useMutation({ mutationKey: mutationKeys.markThreadRead })
  const createThread = useMutation({ mutationFn: ensureThread })

  // Mark the other party's messages read once, when the thread is opened and
  // something is actually unread. Guarded on the id so re-renders and the
  // Realtime pushes that follow do not fire a write per message.
  const markedFor = useRef(null)
  useEffect(() => {
    if (!threadId || markedFor.current === threadId) return
    if (!messages.data?.some((m) => m.sender_id !== user.id && m.read_at === null)) return
    markedFor.current = threadId
    markRead.mutate({ threadId, readerId: user.id })
  }, [threadId, messages.data, user.id, markRead])

  // A member whose professional has never messaged them has no thread row yet.
  // Create it on first open so the composer has somewhere to write.
  useEffect(() => {
    if (!isMember) return
    if (memberThread.isPending || memberThread.data || !profile?.assigned_pro_id) return
    if (createThread.isPending || createThread.isSuccess) return
    createThread.mutate(
      { memberId: user.id, proId: profile.assigned_pro_id },
      { onSuccess: () => memberThread.refetch() },
    )
  }, [isMember, memberThread, profile?.assigned_pro_id, user.id, createThread])

  if (isMember && memberThread.isPending) return <LoadingState />
  if (isMember && memberThread.isError && memberThread.data === undefined) {
    return <ErrorState error={memberThread.error} onRetry={memberThread.refetch} />
  }

  // A member with no professional has nobody to talk to. That is a real state,
  // and the fix is a route, not an error.
  if (isMember && !profile?.assigned_pro_id) {
    return (
      <EmptyState
        title="No trainer yet"
        description="Choose a professional from the Trainer tab and you can message them here."
      />
    )
  }

  const other = isMember ? memberThread.data?.pro : null

  return (
    <Stack sx={{ height: '100%', p: 2 }} spacing={2}>
      {other ? (
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar src={other.avatar_url ?? undefined}>{other.full_name?.[0] ?? '?'}</Avatar>
          <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
            {other.full_name}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="h1">Chat</Typography>
      )}

      {messages.isPending ? <LoadingState /> : null}
      {messages.isError && messages.data === undefined ? (
        <ErrorState error={messages.error} onRetry={messages.refetch} />
      ) : null}
      {messages.data?.length === 0 ? (
        <EmptyState title="No messages yet" description="Say hello." />
      ) : null}

      <Stack spacing={1.5} sx={{ flexGrow: 1 }}>
        {(messages.data ?? []).map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            mine={message.sender_id === user.id}
          />
        ))}
      </Stack>

      <Box sx={{ position: 'sticky', bottom: 0, bgcolor: 'background.default', pt: 1 }}>
        <MessageComposer
          pending={send.isPending}
          paused={send.isPending && send.isPaused}
          error={send.error}
          onSend={(body) =>
            send.mutate({
              // Generated here, in the handler: this write can pause offline and
              // replay, and the id is what makes the replay a no-op instead of a
              // second message. A render-time call would be impure and would
              // defeat it.
              id: crypto.randomUUID(),
              threadId,
              senderId: user.id,
              body,
            })
          }
        />
      </Box>
    </Stack>
  )
}
