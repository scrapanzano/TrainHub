import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase.js'
import { fetchMessages } from '../../data/chat.js'
import { queryKeys, queryPrefixes } from '../../lib/queryKeys.js'

/**
 * One thread's messages, kept live.
 *
 * The query is the source of truth; Realtime only pushes new rows into it. That
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
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [threadId, queryClient])

  return query
}
