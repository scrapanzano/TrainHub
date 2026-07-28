import { supabase } from '../lib/supabase.js'

export async function fetchRewards(memberId) {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, code, title, description, points, earned_at')
    .eq('member_id', memberId)
    .order('earned_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Award a reward once.
 *
 * `rewards` carries `unique (member_id, code)`, so a per-event code -- for a
 * session, `workout:<sessionId>` -- makes this idempotent: replaying the write
 * after a reconnect, or finishing the same session twice, both land on the same
 * row rather than paying out twice.
 */
export async function awardReward({ memberId, code, title, points }) {
  const { data, error } = await supabase
    .from('rewards')
    .upsert(
      { member_id: memberId, code, title, points },
      { onConflict: 'member_id,code', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  // No row means it was already awarded.  That is the intended outcome.
  return data
}
