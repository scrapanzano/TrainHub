import { useEffect, useRef } from 'react'
import { Avatar, Box, Chip, Divider, Stack } from '@mui/material'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { fetchMemberThread, fetchThread } from '../../data/chat.js'
import { queryKeys } from '../../lib/queryKeys.js'
import { mutationKeys } from '../../lib/mutationKeys.js'
import { createUuid } from '../../lib/uuid.js'
import { groupByDay } from '../../lib/dayGroups.js'
import { todayISO } from '../../lib/format.js'
import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState.jsx'
import PageHeader from '../../components/PageHeader.jsx'
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

  // Ordered oldest first by the query; `groupByDay` keeps that order.
  const days = groupByDay(messages.data ?? [], (message) => message.created_at, todayISO())

  // `pb` clears the fixed composer only: `main` already reserves the bottom
  // shell below it, so the old `pb: 12` now double-counted that height.
  return (
    <>
      {/* An avatar and a name in the body of the page, with no way back: the
          only exit was the system gesture. `PageHeader` is the app's rule for
          any screen that is not a bottom-nav root, and the professional's
          inbox is a real parent to return to.

          Outside the padded stack below rather than bled out of it with
          negative margins, so it is the width of the frame by construction --
          the same width as the app bar it pins under. That bar is `fixed` and
          publishes its own height, which is what `top` reads, so this stays
          put while a long conversation scrolls past and follows the bar down
          when the offline or membership banner appears underneath it. */}
      <Box
        sx={{
          position: 'sticky',
          top: 'var(--trainhub-header-height, 56px)',
          zIndex: 2,
          // Less on the left than the message column's own inset: the back
          // button carries `edge="start"`, so this lands the arrow on the same
          // rail a bubble starts on instead of a step inside it. Nothing on the
          // right needs the same compensation.
          pl: 1,
          pr: 2,
          py: 1.25,
          // Paper, not the page ground: the app bar directly above is also on
          // the ground colour, so a matching band read as one tall header of
          // indeterminate height rather than two.
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <PageHeader
          title={other?.full_name ?? 'Chat'}
          subtitle={isMember ? 'Your personal trainer' : 'Client'}
          backTo={isMember ? '/m/trainer' : '/p/chat'}
          backLabel={isMember ? 'Back to your trainer' : 'Back to conversations'}
          titleVariant="h2"
          leading={
            <Avatar src={other?.avatar_url ?? undefined} sx={{ width: 40, height: 40 }}>
              {other?.full_name?.[0] ?? '?'}
            </Avatar>
          }
        />
      </Box>

    <Stack sx={{ minHeight: '100%', p: 2, pb: 9 }} spacing={2}>

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

      {/* A long conversation used to be one unbroken column: nothing said
          where yesterday ended, and every bubble repeated its own clock. Days
          are separated, and a run of messages from one sender is drawn as a
          run -- tight spacing, one timestamp, one tail. */}
      <Stack spacing={4} sx={{ flexGrow: 1, pt: 1 }}>
        {days.map((day) => (
          <Stack key={day.key}>
            <Divider sx={{ mb: 2.5 }}>
              <Chip label={day.label} size="small" />
            </Divider>

            {day.items.map((message, index) => {
              const next = day.items[index + 1]
              const previous = day.items[index - 1]
              // The tail closes a run: the last message of the day, or the one
              // before the other party speaks.
              const tail = !next || next.sender_id !== message.sender_id
              // Tight inside a run, open between them. One spacing for both
              // made a rapid exchange look like one long monologue.
              const opensRun = !previous || previous.sender_id !== message.sender_id
              return (
                <Box key={message.id} sx={{ mt: index === 0 ? 0 : opensRun ? 2 : 0.5 }}>
                  <MessageBubble
                    message={message}
                    mine={message.sender_id === user.id}
                    tail={tail}
                  />
                </Box>
              )
            })}
          </Stack>
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
    </>
  )
}
