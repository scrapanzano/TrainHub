import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which is
// the wrong call offline. Retry only when the browser thinks there is a
// network. Applied to every read below.

const NOTIFICATION_COLUMNS = 'id, type, title, body, url, read_at, created_at'

/** This user's 50 most recent notifications, newest first. */
export async function fetchNotifications(userId) {
  const { data, error } = await supabase
    .from('notifications')
    .select(NOTIFICATION_COLUMNS)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
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

/** Delete one notification. */
export async function deleteNotification({ id }) {
  const { error } = await supabase.rpc('delete_notification_secure', { p_id: id })
  if (error) throw error
}

/** Mark a specific set of this user's notifications read -- a selection. */
export async function markNotificationsReadByIds({ ids }) {
  const { error } = await supabase.rpc('mark_notifications_read_by_ids_secure', { p_ids: ids })
  if (error) throw error
}

/** Delete a specific set of this user's notifications -- a selection. */
export async function deleteNotificationsByIds({ ids }) {
  const { error } = await supabase.rpc('delete_notifications_by_ids_secure', { p_ids: ids })
  if (error) throw error
}

/** Mark every one of this user's notifications read, as of when this was called. */
export async function markAllNotificationsRead({ before }) {
  const { error } = await supabase.rpc('mark_all_notifications_read_secure', { p_before: before })
  if (error) throw error
}

/** Delete every one of this user's notifications as of when this was called, read or unread. */
export async function deleteAllNotifications({ before }) {
  const { error } = await supabase.rpc('delete_all_notifications_secure', { p_before: before })
  if (error) throw error
}
