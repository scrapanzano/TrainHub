import { useEffect, useRef } from 'react'
import { Avatar, Box, Stack, Typography } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchMemberThread, fetchThread } from '../../data/chat.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
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

  const proId = profile?.assigned_pro_id ?? null

  // Only the member needs the lookup; the professional already has the id.
  // Scoped to the assigned professional, not just the member: `threads` is
  // unique per (member, pro) PAIR, and a member who switches professional ends
  // up with two rows -- which a member-only `maybeSingle()` answers PGRST116,
  // breaking the chat permanently. Disabled until the professional is known,
  // since the lookup has no meaning without one.
  const memberThread = useQuery({
    queryKey: queryKeys.memberThread(user.id, proId),
    queryFn: () => fetchMemberThread(user.id, proId),
    enabled: isMember && Boolean(proId),
  })

  const professionalThread = useQuery({
    queryKey: queryKeys.thread(threadIdParam),
    queryFn: () => fetchThread(threadIdParam),
    enabled: !isMember && Boolean(threadIdParam),
  })

  const threadId = isMember ? (memberThread.data?.id ?? null) : threadIdParam

  const messages = useThreadMessages(threadId)
  const send = useMutation({ mutationKey: mutationKeys.sendMessage })
  const markRead = useMutation({ mutationKey: mutationKeys.markThreadRead })
  const createThread = useMutation({ mutationKey: mutationKeys.ensureThread })

  // Mark the other party's messages read whenever the newest unread one
  // changes, rather than once per thread: a live back-and-forth keeps
  // pushing new messages in via Realtime, and a guard keyed on the thread id
  // would only ever fire for the first batch. Keyed on the newest unread
  // message's id (not the whole unread-id set) because it is the smaller
  // guard -- one id comparison catches "the unread set changed" exactly as
  // well as comparing sets would, since a newly-arrived or newly-read
  // message always changes which message is newest-and-unread.
  // `markThreadRead` is idempotent (its filter excludes already-read rows),
  // so a redundant call here would be harmless -- this guard just avoids it.
  const markedUpTo = useRef(null)
  const messagesEnd = useRef(null)
  useEffect(() => {
    if (!threadId) return
    const unread = messages.data?.filter((m) => m.sender_id !== user.id && m.read_at === null)
    const newestUnread = unread?.at(-1) ?? null
    const newestUnreadId = newestUnread?.id ?? null
    if (!newestUnreadId || markedUpTo.current === newestUnreadId) return
    markedUpTo.current = newestUnreadId
    markRead.mutate(
      {
        threadId,
        readerId: user.id,
        readAt: new Date().toISOString(),
        throughCreatedAt: newestUnread.created_at,
      },
      {
        // A permanent failure must be retryable while the same unread message
        // remains newest. Offline mutations pause instead and keep their
        // frozen timestamp for replay.
        onError: () => {
          if (markedUpTo.current === newestUnreadId) markedUpTo.current = null
        },
      },
    )
  }, [threadId, messages.data, user.id, markRead])

  // A chat notification's url is role-specific (patches/020): the member's
  // is the static thread route, the professional's names the thread. Fires
  // once per thread, independent of the message-read-receipt effect above --
  // that one is about individual messages, this one is about the
  // notifications-center row this thread's messages generated.
  const notifiedFor = useRef(null)
  const markNotificationsRead = useMutation({ mutationKey: mutationKeys.markNotificationsRead })
  useEffect(() => {
    if (!threadId || notifiedFor.current === threadId) return
    notifiedFor.current = threadId
    markNotificationsRead.mutate({
      url: isMember ? '/m/trainer/chat' : `/p/chat/${threadId}`,
    })
  }, [threadId, isMember, markNotificationsRead])

  useEffect(() => {
    if (!messages.data?.length) return
    messagesEnd.current?.scrollIntoView({ block: 'end' })
  }, [messages.data?.length])

  // A member whose professional has never messaged them has no thread row yet.
  // Create it on first open so the composer has somewhere to write. Guarded
  // on isError too: without it, a failed `ensureThread` (RLS denial,
  // transient network error) leaves `memberThread.data` unset, the effect's
  // dependencies change on every mutation state transition, and the guard
  // would let `mutate` fire again immediately -- an uncontrolled retry loop.
  useEffect(() => {
    if (!isMember) return
    if (memberThread.isPending || memberThread.data || !proId) return
    if (createThread.isPending || createThread.isSuccess || createThread.isError) return
    createThread.mutate(
      { memberId: user.id, proId },
      { onSuccess: () => memberThread.refetch() },
    )
  }, [isMember, memberThread, proId, user.id, createThread])

  // A member with no professional has nobody to talk to. That is a real state,
  // and the fix is a route, not an error. Checked before the pending gate
  // below: the lookup is disabled without a professional, so it stays `pending`
  // forever and would otherwise show an endless spinner.
  if (isMember && !proId) {
    return (
      <EmptyState
        title="No trainer yet"
        description="Choose a professional from the Trainer tab and you can message them here."
      />
    )
  }

  if (isMember && memberThread.isPending) return <LoadingState />
  if (isMember && memberThread.isError && memberThread.data === undefined) {
    return <ErrorState error={memberThread.error} onRetry={memberThread.refetch} />
  }
  // `createThread.isError` short-circuits the effect above forever (by design --
  // otherwise a failed create would retry in an uncontrolled loop), so without
  // this the screen would sit on an empty/loading state with no way out.
  // Calling `mutate` again moves the mutation out of its error state, which is
  // what lets the effect's guard open again on a future re-render.
  if (isMember && createThread.isError && !memberThread.data) {
    return (
      <ErrorState
        error={createThread.error}
        onRetry={() =>
          createThread.mutate(
            { memberId: user.id, proId },
            { onSuccess: () => memberThread.refetch() },
          )
        }
      />
    )
  }

  if (!isMember && professionalThread.isPending) return <LoadingState />
  if (!isMember && professionalThread.isError && professionalThread.data === undefined) {
    return <ErrorState error={professionalThread.error} onRetry={professionalThread.refetch} />
  }
  if (!isMember && !professionalThread.data) {
    return <EmptyState title="Conversation not available" description="This chat no longer exists." />
  }

  const other = isMember ? memberThread.data?.pro : professionalThread.data?.member

  return (
    <Stack sx={{ minHeight: '100%', p: 2, pb: 12 }} spacing={2}>
      {other ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Avatar src={other.avatar_url ?? undefined}>{other.full_name?.[0] ?? '?'}</Avatar>
          <Typography variant="h1" sx={{ fontSize: '1.5rem' }}>
            {other.full_name}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="h1">Chat</Typography>
      )}

      {/* The thread row does not exist yet and `ensureThread` is creating it.
          Offline that write pauses indefinitely, so this is a lasting state and
          not a momentary spinner -- say so rather than turning forever. */}
      {!threadId ? (
        <EmptyState
          title="Setting up your chat"
          description="This finishes as soon as you are back online."
        />
      ) : null}
      {threadId && messages.isPending ? <LoadingState /> : null}
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
        <Box ref={messagesEnd} aria-hidden />
      </Stack>

      {/* Gated on the thread id, not merely hidden while loading: with
          `threadId` still null a send queues `thread_id: null`, which fails the
          not-null constraint on reconnect and loses the message. Online the
          window is milliseconds; offline `ensureThread` never settles and it
          would be permanent. */}
      {threadId ? (
        <Box
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 'calc(var(--trainhub-bottom-shell-height, 56px) + env(safe-area-inset-bottom))',
            zIndex: 'appBar',
            bgcolor: 'background.default',
            borderTop: 1,
            borderColor: 'divider',
            px: 2,
            py: 1,
          }}
        >
          <MessageComposer
            paused={send.isPending && send.isPaused}
            error={send.error}
            onSend={(body) =>
              send.mutate({
                // Generated here, in the handler: this write can pause offline
                // and replay, and the id is what makes the replay a no-op
                // instead of a second message. A render-time call would be
                // impure and would defeat it.
                id: createUuid(),
                threadId,
                senderId: user.id,
                body,
              })
            }
          />
        </Box>
      ) : null}
    </Stack>
  )
}
