import { supabase } from '../lib/supabase.js'

// postgrest retries a failed GET three times with 1s/2s/4s backoff, which is
// the right call for a transient 503 and the wrong one for a phone in a gym
// basement: it turns "offline" into seven seconds of nothing. Retry only when
// the browser thinks there is a network, so the transient-error handling is
// kept and the offline path fails immediately.

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
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

// The professional's side of the same table.  The embed is the MEMBER rather
// than the professional, and the constraint is named for the same reason as
// above: `appointments` references `profiles` twice.
const AGENDA_COLUMNS =
  'id, kind, status, starts_at, ends_at, notes, member:profiles!appointments_member_id_fkey ( id, full_name, avatar_url )'

/**
 * Every appointment in the professional's day.
 *
 * Bounds built from the local day and converted by `toISOString`, exactly as
 * `fetchAppointmentsOnDay` does: comparing a `timestamptz` against a bare date
 * string compares against UTC midnight and silently drops the evening's work
 * for anyone east of Greenwich.
 */
export async function fetchAgendaOnDay(proId, dayISO) {
  const [year, month, day] = dayISO.split('-').map(Number)
  const from = new Date(year, month - 1, day, 0, 0, 0, 0)
  const to = new Date(year, month - 1, day + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(AGENDA_COLUMNS)
    .eq('pro_id', proId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/**
 * Every appointment between two local calendar days, inclusive of both.
 *
 * The calendar fetches a whole visible month in one request and filters in
 * memory for the selected day: a query per day would be up to 42 requests for
 * one screen, and each one would miss the persisted cache on a different key.
 */
export async function fetchAppointmentsInRange(proId, fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split('-').map(Number)
  const [ty, tm, td] = toISO.split('-').map(Number)
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
  // One day past the end, so the last day's appointments are included.
  const to = new Date(ty, tm - 1, td + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(AGENDA_COLUMNS)
    .eq('pro_id', proId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/** One appointment, for the detail screen. */
export async function fetchAppointment(appointmentId) {
  const { data, error } = await supabase
    .from('appointments')
    .select(AGENDA_COLUMNS)
    .eq('id', appointmentId)
    .single()
    .retry(navigator.onLine)

  if (error) throw error
  return data
}

/**
 * Book one appointment.
 *
 * The caller supplies `id` so an offline replay is idempotent. The secure
 * operation derives the initial status from the authenticated role: a member
 * requests `pending`, while the assigned professional books `confirmed`.
 */
export async function createAppointment({
  id,
  memberId,
  proId,
  kind,
  startsAt,
  endsAt,
  notes,
}) {
  const { data, error } = await supabase
    .rpc('create_appointment_secure', {
      p_id: id,
      p_member_id: memberId,
      p_pro_id: proId,
      p_kind: kind,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_notes: notes || null,
    })
    .single()

  if (error) throw error
  return data
}

// The member's side of the range query. Same bounds arithmetic as the
// professional's; the filter and the embed are the other way round.
const MEMBER_AGENDA_COLUMNS =
  'id, kind, status, starts_at, ends_at, notes, pro:profiles!appointments_pro_id_fkey ( id, full_name, avatar_url )'

/**
 * Every appointment the member has between two local calendar days, inclusive
 * of both. Mirrors `fetchAppointmentsInRange`: same bounds arithmetic, but
 * filtered on `member_id` and embedding the professional rather than the
 * member.
 */
export async function fetchMemberAppointmentsInRange(memberId, fromISO, toISO) {
  const [fy, fm, fd] = fromISO.split('-').map(Number)
  const [ty, tm, td] = toISO.split('-').map(Number)
  const from = new Date(fy, fm - 1, fd, 0, 0, 0, 0)
  // One day past the end, so the last day's appointments are included.
  const to = new Date(ty, tm - 1, td + 1, 0, 0, 0, 0)

  const { data, error } = await supabase
    .from('appointments')
    .select(MEMBER_AGENDA_COLUMNS)
    .eq('member_id', memberId)
    .gte('starts_at', from.toISOString())
    .lt('starts_at', to.toISOString())
    .order('starts_at')
    .retry(navigator.onLine)

  if (error) throw error
  return data ?? []
}

/** Move an appointment through a checked, compare-and-set transition. */
export async function setAppointmentStatus({ appointmentId, expectedStatus, status }) {
  const { data, error } = await supabase
    .rpc('set_appointment_status_secure', {
      p_appointment_id: appointmentId,
      p_expected_status: expectedStatus,
      p_status: status,
    })
    .single()

  if (error) throw error
  return data
}
