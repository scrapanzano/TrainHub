import { supabase } from '../lib/supabase.js'

/**
 * Mint one badge token.
 *
 * The caller supplies `token`; `expires_at` is deliberately absent from the
 * insert, because the column default computes it from the DATABASE clock. A
 * device an hour fast would otherwise mint a badge that is already dead, or one
 * that outlives its minute.
 *
 * Not registered in `src/data/mutations.js` on purpose: a token replayed on
 * reconnect, long after the member left the door, is worth nothing to anyone.
 * Offline this simply fails, and the screen says so.
 */
export async function mintCheckinToken({ memberId, token }) {
  const { data, error } = await supabase
    .from('checkin_tokens')
    .insert({ member_id: memberId, token })
    .select('token, expires_at')
    .single()

  if (error) throw error
  return data
}

/**
 * Redeem a scanned badge.
 *
 * The professional never reads `checkin_tokens`; this function is
 * `security definer` and does the checking server-side. It answers with a
 * `status` of 'ok', 'unknown', 'used' or 'expired' -- three different failures
 * that need three different messages -- and, on 'ok', with who just walked in.
 *
 * Not registered in `src/data/mutations.js`: replaying a check-in an hour later
 * records an entry that never happened.
 */
export async function redeemCheckinToken(token) {
  const { data, error } = await supabase
    .rpc('redeem_checkin_token', { p_token: token })
    .single()

  if (error) throw error
  return data
}
