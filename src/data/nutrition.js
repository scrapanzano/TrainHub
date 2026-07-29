import { supabase } from '../lib/supabase.js'

/**
 * The member's current nutrition plan and its meals.
 *
 * "Current" is the most recently created, matching `fetchActivePlan`'s rule for
 * workouts.  Returns null rather than throwing when there is none: a client
 * whose nutrition has not been written yet is an ordinary state that both the
 * dossier and the editor render as an empty one.
 */
export async function fetchNutritionPlan(memberId) {
  const { data: plan, error: planError } = await supabase
    .from('nutrition_plans')
    .select('id, name, kcal_target, protein_g, carbs_g, fat_g, created_at')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .retry(navigator.onLine)

  if (planError) throw planError
  if (!plan) return null

  const { data: meals, error: mealsError } = await supabase
    .from('meals')
    .select('id, name, time_of_day, position, items, kcal')
    .eq('plan_id', plan.id)
    .order('position')
    .retry(navigator.onLine)

  if (mealsError) throw mealsError
  return { plan, meals: meals ?? [] }
}
