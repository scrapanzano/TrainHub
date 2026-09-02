import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which turns
// "offline" into seven seconds of nothing.  Retry only when the browser thinks
// there is a network.  Applied to every read below.

/**
 * The professional's client roster.
 *
 * `assigned_pro_id` is the only filter, and it is also what
 * `profiles_select_own_clients` enforces -- the filter narrows a statement RLS
 * has already made safe, it is not what makes it safe.
 *
 * The embed names its foreign key: `workout_plans` points at `profiles` twice
 * (`member_id` and `author_id`), and an unqualified embed fails at runtime with
 * "more than one relationship was found".
 */
export async function fetchClients(proId) {
  const { data, error } = await supabase
    .from('profiles')
    .select(
      `id, full_name, avatar_url, subscription_status, subscription_until,
       workout_plans!workout_plans_member_id_fkey ( goal, created_at )`,
    )
    .eq('assigned_pro_id', proId)
    .order('full_name')
    .retry(navigator.onLine)

  if (error) throw error

  return (data ?? []).map(({ workout_plans: plans, ...client }) => ({
    ...client,
    // The roster prints the current goal.  PostgREST does not order embedded
    // rows, so pick the newest plan here rather than trusting insertion order.
    goal:
      [...(plans ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.goal ?? null,
  }))
}

/** One client's profile, for the dossier header. */
export async function fetchClient(clientId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, bio, subscription_status, subscription_until, created_at')
    .eq('id', clientId)
    .single()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}
