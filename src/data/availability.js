import { supabase } from '../lib/supabase.js'

/**
 * The professional's recurring weekly slots.
 *
 * Ordered by weekday then start time so the screen can group without sorting.
 * `weekday` follows Postgres' convention: 0 is Sunday.
 */
export async function fetchAvailability(proId) {
  const { data, error } = await supabase
    .from('availability')
    .select('id, weekday, starts_at, ends_at')
    .eq('pro_id', proId)
    .order('weekday')
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Add one slot.
 *
 * The caller supplies `id` for the same reason `logSet` does: this write can
 * pause offline and be replayed, and upserting on the client's id turns the
 * replay into a no-op instead of a duplicate slot.
 *
 * The database enforces `ends_at > starts_at` and `weekday between 0 and 6`, so
 * a malformed slot is rejected there rather than trusted from the client.
 */
export async function addAvailability({ id, proId, weekday, startsAt, endsAt }) {
  const { data, error } = await supabase
    .from('availability')
    .upsert(
      { id, pro_id: proId, weekday, starts_at: startsAt, ends_at: endsAt },
      { onConflict: 'id', ignoreDuplicates: true },
    )
    .select()
    .maybeSingle()

  if (error) throw error
  return data
}

/** Remove one slot.  Idempotent: deleting a row that is already gone is a no-op. */
export async function deleteAvailability({ availabilityId }) {
  const { error } = await supabase.from('availability').delete().eq('id', availabilityId)
  if (error) throw error
}
