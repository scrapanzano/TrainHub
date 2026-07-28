import { supabase } from '../lib/supabase.js'

/**
 * Every appointment the member has on one local calendar day.
 *
 * The bounds are built from the local day and converted to UTC by `toISOString`,
 * so "today" means the member's today.  Comparing the timestamptz column against
 * a bare date string would instead compare against UTC midnight and drop the
 * evening's appointments for anyone east of Greenwich.
 */
export async function fetchAppointmentsOnDay(memberId, dayISO) {
  const [year, month, day] = dayISO.split('-').map(Number)
  const from = new Date(year, month - 1, day, 0, 0, 0, 0)
  const to = new Date(year, month - 1, day + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(
      'id, kind, status, starts_at, ends_at, notes, pro:profiles!appointments_pro_id_fkey ( id, full_name, avatar_url )',
    )
    .eq('member_id', memberId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')

  if (error) throw error
  return data ?? []
}
