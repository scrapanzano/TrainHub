import { supabase } from '../lib/supabase.js'

export const PROFILE_UPDATED_EVENT = 'trainhub:profile-updated'

const PROFILE_COLUMNS =
  'id, role, specialty, full_name, avatar_url, bio, assigned_pro_id, subscription_status, subscription_until'

/**
 * Every professional a member can choose from.
 *
 * `profiles_select_professionals` permits this for any signed-in user. Its
 * `auth.uid() is not null` guard is what keeps it from being public -- a policy
 * whose `using` clause never mentions the caller is readable by anyone holding
 * the publishable key, which ships in the bundle. Phase 0 shipped that hole.
 */
export async function fetchProfessionals() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, bio, specialty')
    .eq('role', 'professional')
    .order('full_name')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Assign a professional to the member.
 *
 * Scoped to the member's own row by `profiles_update_self`; passing anyone
 * else's id is rejected by the database, not by this function.
 */
export async function chooseProfessional({ memberId, proId }) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ assigned_pro_id: proId })
    .eq('id', memberId)
    // Return the complete shell profile. AuthProvider mirrors this row outside
    // TanStack Query, so a partial response would either erase fields or force
    // a page reload merely to learn the new assignment.
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw error

  // Dispatched by the mutation function rather than a component callback, so
  // it also runs when a paused mutation is restored after a reload.
  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: data }))
  return data
}

/** Where a member's photo lives, one object per user, replaced in place. */
const AVATAR_BUCKET = 'avatars'
const avatarPath = (userId) => `${userId}/avatar.jpg`

/**
 * Replace the signed-in user's profile photo.
 *
 * Two writes, in this order on purpose: the object first, the row second. A
 * failed upload must not leave `avatar_url` pointing at nothing, whereas an
 * orphaned object costs a few kilobytes and is overwritten by the next upload.
 *
 * The stored path never changes, so the URL would be cached by the browser
 * for the life of the install and a new photo would simply not appear. The
 * upload's own timestamp rides along as a query string to break that.
 *
 * `supabase/patches/025-avatar-storage.sql` creates the bucket and its
 * policies. Without it this fails with a clear storage error rather than
 * writing a broken row.
 */
export async function uploadAvatar({ userId, blob }) {
  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(avatarPath(userId), blob, { upsert: true, contentType: 'image/jpeg' })

  if (uploadError) throw uploadError

  const { data: published } = supabase.storage
    .from(AVATAR_BUCKET)
    .getPublicUrl(avatarPath(userId))

  const url = `${published.publicUrl}?v=${Date.now()}`

  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw error

  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: data }))
  return data
}

/**
 * Drop the photo and fall back to the initial.
 *
 * The row is cleared first here, the reverse of `uploadAvatar`: a profile
 * pointing at a deleted object shows a broken image, so the pointer must go
 * before the thing it points at. A storage removal that then fails leaves an
 * unreferenced object, which the next upload overwrites anyway.
 */
export async function clearAvatar({ userId }) {
  const { data, error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single()

  if (error) throw error

  await supabase.storage.from(AVATAR_BUCKET).remove([avatarPath(userId)])

  window.dispatchEvent(new CustomEvent(PROFILE_UPDATED_EVENT, { detail: data }))
  return data
}
