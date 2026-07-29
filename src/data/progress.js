import { supabase } from '../lib/supabase.js'

/**
 * The client's logged sets since `sinceISO`.
 *
 * A professional reaches these through `set_logs_select`, which is gated on
 * `owns_member` -- they can read a client's training but `set_logs_write_self`
 * means they can never invent it.
 */
export async function fetchClientTraining(memberId, sinceISO) {
  const { data, error } = await supabase
    .from('set_logs')
    .select('id, performed_at, reps, weight')
    .eq('member_id', memberId)
    .gte('performed_at', sinceISO)
    .order('performed_at', { ascending: false })
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

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
 * Upserts on `(member_id, measured_on)`: one measurement per client per day is
 * the real rule, and it also makes the write idempotent, so a save that pauses
 * offline and replays on reconnect lands on the same row rather than a second
 * reading for the same morning.
 */
export async function saveBodyMetric({ memberId, recordedById, measuredOn, weightKg, note }) {
  const { data, error } = await supabase
    .from('body_metrics')
    .upsert(
      {
        member_id: memberId,
        recorded_by_id: recordedById,
        measured_on: measuredOn,
        weight_kg: weightKg ?? null,
        note: note || null,
      },
      { onConflict: 'member_id,measured_on' },
    )
    .select('id, measured_on, weight_kg, note')
    .single()

  if (error) throw error
  return data
}
