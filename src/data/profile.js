import { supabase } from '../lib/supabase.js'

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
    .select('id, assigned_pro_id')
    .single()

  if (error) throw error
  return data
}
