import { supabase } from '../lib/supabase.js'

const MEAL_COLUMNS =
  'id, name, time_of_day, position, kcal, protein_g, carbs_g, fat_g, alternatives, items'
const DAY_COLUMNS = `id, name, position, weekdays, meals ( ${MEAL_COLUMNS} )`

/**
 * The member's current nutrition plan, its day types, and their meals.
 *
 * "Current" is the most recently created plan, matching `fetchActivePlan`'s
 * rule for workouts. Returns null rather than throwing when there is none.
 */
export async function fetchNutritionPlan(memberId) {
  const { data: plan, error: planError } = await supabase
    .from('nutrition_plans')
    .select('id, name, kcal_target, protein_g, carbs_g, fat_g, notes, created_at, replaces_plan_id')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .retry(navigator.onLine)

  if (planError) throw planError
  if (!plan) return null

  const { data: days, error: daysError } = await supabase
    .from('nutrition_days')
    .select(DAY_COLUMNS)
    .eq('plan_id', plan.id)
    .order('position')
    .retry(navigator.onLine)

  if (daysError) throw daysError

  return {
    plan,
    days: (days ?? []).map((day) => ({
      ...day,
      // PostgREST does not order rows embedded through a foreign table.
      meals: [...(day.meals ?? [])].sort((a, b) => a.position - b.position),
    })),
  }
}

/**
 * Create a nutrition plan for a client -- meta, every day type, and every
 * meal -- in one atomic call. Only the client's assigned professional may
 * call this: unlike workout plans, a client never authors their own
 * nutrition plan (doc/nutrition_plan.md).
 */
export async function createNutritionPlan({
  id, memberId, replacesPlanId, name, kcalTarget, proteinG, carbsG, fatG, notes, days,
}) {
  const { data, error } = await supabase
    .rpc('create_nutrition_plan_secure', {
      p_plan_id: id,
      p_member_id: memberId,
      p_replaces_plan_id: replacesPlanId ?? null,
      p_name: name,
      p_kcal_target: kcalTarget,
      p_protein_g: proteinG,
      p_carbs_g: carbsG,
      p_fat_g: fatG,
      p_notes: notes || null,
      p_days: days,
    })
    .single()

  if (error) throw error
  return data
}
