import { supabase } from '../lib/supabase.js'

// Crockford-style alphabet -- no 0/O, 1/I/L -- so a code read aloud or typed
// by hand rarely trips on a lookalike character. 256 is divisible by 32, so
// `byte % 32` is uniform, no modulo bias.
const BADGE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/**
 * A short, unpredictable badge code: 8 characters from a 32-symbol alphabet is
 * 40 bits, far more than an authenticated professional could brute-force
 * through the scanner within the token's sixty-second lifetime -- and only an
 * authenticated professional can call `redeem_checkin_token` at all. Traded
 * down from a full UUID because nobody can read 36 characters to a front desk.
 */
export function generateBadgeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (byte) => BADGE_CODE_ALPHABET[byte % BADGE_CODE_ALPHABET.length]).join('')
}

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
 *
 * Returns `lifetimeMs` alongside the row: `expires_at - created_at`, two
 * DATABASE timestamps, so the number never mixes clocks. Subtracting
 * `Date.now()` from `expires_at` instead would make a phone a minute fast see
 * every fresh token as already expired and re-mint in a loop, and a slow phone
 * count down over a badge that died minutes ago.
 */
export async function mintCheckinToken({ memberId, token }) {
  const { data, error } = await supabase
    .from('checkin_tokens')
    .insert({ member_id: memberId, token })
    .select('token, expires_at, created_at')
    .single()

  if (error) throw error
  return {
    ...data,
    lifetimeMs: new Date(data.expires_at).getTime() - new Date(data.created_at).getTime(),
  }
}

/**
 * Redeem a scanned badge.
 *
 * The professional never reads `checkin_tokens`; this function is
 * `security definer` and does the checking server-side. It answers with a
 * `status` of 'ok', 'unknown', 'used', 'expired' or 'suspended'. Only `ok`
 * consumes the token and records a check-in; subscription failures return the
 * member details so the scanner can explain the refusal.
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
