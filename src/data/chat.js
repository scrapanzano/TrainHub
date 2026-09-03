import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which turns
// "offline" into seven seconds of nothing.  Retry only when the browser thinks
// there is a network.  Applied to every read below.

const MESSAGE_COLUMNS = 'id, thread_id, sender_id, body, read_at, created_at'

/**
 * The member's thread with their assigned professional, creating it on first
 * use.
 *
 * The secure operation validates the current assignment and returns the same
 * row when two devices open the pair concurrently.
 */
export async function ensureThread({ memberId, proId }) {
  const { data, error } = await supabase
    .rpc('ensure_assigned_thread', {
      p_member_id: memberId,
      p_pro_id: proId,
    })
    .single()

  if (error) throw error
  return data
}

/**
 * The member's thread with one professional, if it exists.
 *
 * Scoped to the pair, not to the member: `threads` is `unique (member_id,
 * pro_id)`, so a member who switches professional owns two rows and a
 * member-only filter makes `maybeSingle()` answer `PGRST116` -- a permanent
 * error on a screen whose Retry can never clear it.
 *
 * Returns null rather than throwing when the pair has never messaged: that is
 * an ordinary state the screen renders as an empty one.
 */
export async function fetchMemberThread(memberId, proId) {
  const { data, error } = await supabase
    .from('threads')
    .select('id, pro:profiles!threads_pro_id_fkey ( id, full_name, avatar_url )')
    .eq('member_id', memberId)
    .eq('pro_id', proId)
    .maybeSingle()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/** One thread with both participants, used to title the conversation. */
export async function fetchThread(threadId) {
  const { data, error } = await supabase
    .from('threads')
    .select(`
      id,
      member:profiles!threads_member_id_fkey ( id, full_name, avatar_url ),
      pro:profiles!threads_pro_id_fkey ( id, full_name, avatar_url )
    `)
    .eq('id', threadId)
    .maybeSingle()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/**
 * The professional's inbox.
 *
 * The messages are embedded whole and rolled up here rather than asked for as
 * aggregates: PostgREST cannot express "count the unread ones from the other
 * party" in an embed, and this is one professional's own threads.
 *
 * ponytail: fetches every message in every thread. Fine at demo scale (tens of
 * rows); if a thread ever grows long, move the last-message and unread count
 * into a database view and select from that instead.
 */
export async function fetchThreads(proId) {
  const { data, error } = await supabase
    .from('threads')
    .select(
      `id, created_at,
       member:profiles!threads_member_id_fkey ( id, full_name, avatar_url ),
       messages ( ${MESSAGE_COLUMNS} )`,
    )
    .eq('pro_id', proId)
    .retry(navigator.onLine)

  if (error) throw error

  return (data ?? [])
    .map(({ messages, ...thread }) => {
      // PostgREST does not order embedded rows, so sort here rather than
      // trusting insertion order.
      const ordered = [...(messages ?? [])].sort((a, b) =>
        a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      )
      return {
        ...thread,
        lastMessage: ordered.at(-1) ?? null,
        // Unread means: sent by the other party and never marked read.
        unreadCount: ordered.filter((m) => m.sender_id !== proId && m.read_at === null).length,
      }
    })
    // Most recently active first; a thread with no messages yet sorts last.
    .sort((a, b) => {
      const at = a.lastMessage?.created_at ?? ''
      const bt = b.lastMessage?.created_at ?? ''
      return bt.localeCompare(at) || a.id.localeCompare(b.id)
    })
}

/** One conversation, oldest first, which is the order it is rendered in. */
export async function fetchMessages(threadId) {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', threadId)
    .order('created_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Send one message.
 *
 * The caller supplies `id`.  `messages.id` has no database default precisely so
 * this can be an upsert that ignores duplicates: a send that pauses offline is
 * replayed on reconnect, and a plain insert would fail that replay with a
 * primary-key violation the user would read as a lost message.
 *
 * `created_at` is left to the column default on purpose, unlike `set_logs`: a
 * message's meaningful time is when it reached the other person, and a chat
 * that reorders itself around a phone's clock is worse than one that stamps a
 * queued message late.
 */
export async function sendMessage({ id, threadId, senderId, body }) {
  const { data, error } = await supabase
    .from('messages')
    .upsert(
      { id, thread_id: threadId, sender_id: senderId, body },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select(MESSAGE_COLUMNS)
    .maybeSingle()

  if (error) throw error
  // `ignoreDuplicates` returns no row on a replay.  That is success.
  return data
}

/**
 * Mark everything the other party sent in this thread as read.
 *
 * Idempotent by construction: rows already carrying a `read_at` are excluded by
 * the filter, so a replay updates nothing. `readAt` and `throughCreatedAt` are
 * supplied by the caller and therefore remain stable if the mutation pauses
 * offline. The boundary is the newest row actually rendered, not the device's
 * current clock: a phone set five minutes ahead must not mark a later message
 * as read when an offline receipt eventually replays.
 */
export async function markThreadRead({ threadId, readerId, readAt, throughCreatedAt }) {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: readAt })
    .eq('thread_id', threadId)
    .neq('sender_id', readerId)
    // A receipt queued offline may replay after newer messages arrive. Freeze
    // the visible boundary as well as the timestamp so those later messages
    // remain unread until the user actually opens the thread again.
    // Fall back to `readAt` for a receipt persisted by an older app build.
    .lte('created_at', throughCreatedAt ?? readAt)
    .is('read_at', null)

  if (error) throw error
}
