import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase.js'
import { fetchMessages } from '../../data/chat.js'
import { queryKeys, queryPrefixes } from '../../lib/queryKeys.js'

/**
 * One thread's messages, kept live.
 *
 * The query is the source of truth; Realtime only pushes new rows into it, and
 * replaces a row when its read receipt lands. That
 * keeps every existing guarantee -- the persisted cache, the offline gate, the
 * `data === undefined` error rule -- and makes the socket an optimisation
 * rather than a second, divergent data path. If the subscription never fires,
 * the screen still works; it just stops updating on its own.
 *
 * @param {?string} threadId Null until the thread is known.
 */
export function useThreadMessages(threadId) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.threadMessages(threadId),
    queryFn: () => fetchMessages(threadId),
    enabled: Boolean(threadId),
  })

  useEffect(() => {
    if (!threadId) return

    const channel = supabase
      .channel(`messages:${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          queryClient.setQueryData(queryKeys.threadMessages(threadId), (current) => {
            // Undefined means the first fetch has not landed; there is nothing
            // to append to, and the fetch will include this row anyway.
            if (!current) return current
            // The sender already has this row from `sendMessage`'s `onMutate`
            // (registered in `src/data/mutations.js`, keyed on the same
            // client-generated id), and Realtime re-delivers on reconnect. Both
            // make duplicates possible, and a duplicated message is a visible
            // bug.
            if (current.some((message) => message.id === payload.new.id)) return current
            return [...current, payload.new]
          })
          // The inbox row, its unread badge and the header bell all count
          // messages. Invalidate the whole family through the prefix rather
          // than naming each key: prefix matching cannot be defeated by a
          // caller that omits an id.
          queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          // The only UPDATE this table takes is `markThreadRead` stamping
          // `read_at` -- `patches/008` revoked every other column from the app
          // role -- and the person who needs to see it is the SENDER, whose own
          // query has no interval and does not refetch on focus. Without this
          // the second tick waited for the next message either side sent, so a
          // receipt could sit unseen for the rest of the conversation.
          //
          // `patches/007`'s `replica identity full` is what makes this payload
          // usable; it was set for exactly this feature.
          queryClient.setQueryData(queryKeys.threadMessages(threadId), (current) => {
            if (!current) return current
            // Returning `current` unchanged when the row is not held matters:
            // a new array identity re-renders every bubble in the thread for
            // nothing.
            let found = false
            const next = current.map((message) => {
              if (message.id !== payload.new.id) return message
              found = true
              return payload.new
            })
            return found ? next : current
          })
          // No invalidation here. A read receipt changes nothing the recipient
          // of this event counts -- the reader's own `markThreadRead` already
          // invalidates the chat family on their side, and the sender's unread
          // count never included their own messages.
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [threadId, queryClient])

  return query
}
