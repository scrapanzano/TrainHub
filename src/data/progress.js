import { supabase } from '../lib/supabase.js'

/** Every check-in measurement, newest first. */
export async function fetchBodyMetrics(memberId) {
  const { data, error } = await supabase
    .from('body_metrics')
    .select('id, measured_on, weight_kg, note, recorded_by_id')
    .eq('member_id', memberId)
    .order('measured_on', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Record one check-in.
 *
 * The secure operation derives the recorder from the authenticated session and
 * upserts on `(member_id, measured_on)`. Null means "not supplied", so a later
 * partial save preserves the value already stored that day.
 */
export async function saveBodyMetric({ memberId, measuredOn, weightKg, note }) {
  const { data, error } = await supabase
    .rpc('save_body_metric_secure', {
      p_member_id: memberId,
      p_measured_on: measuredOn,
      p_weight_kg: weightKg ?? null,
      p_note: note?.trim() || null,
    })
    .single()

  if (error) throw error
  return data
}
