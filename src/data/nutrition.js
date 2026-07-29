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

/**
 * Create or update a nutrition plan.
 *
 * One statement for both, because the caller knows the id only when the plan
 * already exists.  `id: undefined` is dropped by supabase-js, so the insert
 * branch lets the column default fire; with an id present, `onConflict: 'id'`
 * turns it into an update.  RLS (`nutrition_plans_write_pro`) requires the
 * caller to be a professional who owns this member either way.
 */
export async function saveNutritionPlan({
  id,
  memberId,
  authorId,
  name,
  kcalTarget,
  proteinG,
  carbsG,
  fatG,
}) {
  const row = {
    member_id: memberId,
    author_id: authorId,
    name,
    kcal_target: kcalTarget ?? null,
    protein_g: proteinG ?? null,
    carbs_g: carbsG ?? null,
    fat_g: fatG ?? null,
  }
  if (id) row.id = id

  const { data, error } = await supabase
    .from('nutrition_plans')
    .upsert(row, { onConflict: 'id' })
    .select('id')
    .single()

  if (error) throw error
  return data
}

/**
 * Create or update one meal.
 *
 * `position` carries `unique (plan_id, position)`, so the caller must pass one
 * past the highest in use rather than `length + 1` -- the two agree only while
 * positions run contiguously, and they stop the first time a meal is deleted.
 */
export async function saveMeal({ id, planId, name, timeOfDay, position, kcal, items }) {
  const row = {
    plan_id: planId,
    name,
    time_of_day: timeOfDay,
    position,
    kcal: kcal ?? null,
    items: items ?? [],
  }
  if (id) row.id = id

  const { data, error } = await supabase
    .from('meals')
    .upsert(row, { onConflict: 'id' })
    .select('id, name, time_of_day, position, items, kcal')
    .single()

  if (error) throw error
  return data
}

/** Remove one meal.  Idempotent: deleting a row that is already gone is a no-op. */
export async function deleteMeal({ mealId }) {
  const { error } = await supabase.from('meals').delete().eq('id', mealId)
  if (error) throw error
}
