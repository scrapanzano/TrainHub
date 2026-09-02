import { supabase } from '../lib/supabase.js'

export async function fetchRewards(memberId) {
  const { data, error } = await supabase
    .from('rewards')
    .select('id, code, title, description, points, earned_at, run_id, workout_session_id, reward_day')
    .eq('member_id', memberId)
    .order('earned_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}
