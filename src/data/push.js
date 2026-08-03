import { supabase } from '../lib/supabase.js'

/**
 * Record this device's subscription.
 *
 * `endpoint` is unique in the schema, so re-subscribing the same device updates
 * its row instead of accumulating a second one. Not registered in
 * `src/data/mutations.js`: a subscription replayed after the user turned
 * notifications off would silently turn them back on.
 */
export async function savePushSubscription({ userId, subscription }) {
  const json = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
    { onConflict: 'endpoint' },
  )

  if (error) throw error
}

/** Forget one device. */
export async function deletePushSubscription(endpoint) {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) throw error
}
