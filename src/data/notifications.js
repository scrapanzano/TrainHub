import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which is
// the wrong call offline. Retry only when the browser thinks there is a
// network. Applied to every read below.

const NOTIFICATION_COLUMNS = 'id, type, title, body, url, read_at, created_at'

/** Every notification for this user, newest first. */
export async function fetchNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/** How many of this user's notifications are unread, for the bell's badge. */
export async function fetchUnreadNotificationCount(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
    .retry(navigator.onLine)

  if (error) throw error
  return count ?? 0
}

/** Mark one notification read -- tapping it in the list. */
export async function markNotificationRead({ id }) {
  const { error } = await supabase.rpc('mark_notification_read_secure', { p_id: id })
  if (error) throw error
}

/**
 * Mark every one of this user's unread notifications for one URL read --
 * called when the page a notification points at is actually visited,
 * however the visitor got there. The RPC only touches rows still unread, so
 * calling it again for a page with nothing new is a harmless no-op.
 */
export async function markNotificationsRead({ url }) {
  const { error } = await supabase.rpc('mark_notifications_read_secure', { p_url: url })
  if (error) throw error
}
