import { createUuid } from '../../lib/uuid.js'

/**
 * Freeze a meal's food items into the JSON contract
 * `create_nutrition_plan_secure` (patches/022) consumes.
 *
 * No id is needed here: unlike meals and days, items have no table row of
 * their own -- they live inside `meals.items jsonb`. Rows the user added and
 * left blank are dropped rather than written as empty objects.
 */
export function buildMealItemPayloads(items) {
  return (items ?? [])
    .filter((item) => item.food?.trim())
    .map((item) => ({ food: item.food.trim(), qty: item.qty || '' }))
}

/**
 * Freeze a day type's meals into the JSON contract the RPC consumes. IDs are
 * created before the mutation is queued, so an offline replay sends the
 * exact same meal rows instead of inventing new ones on every attempt.
 */
export function buildMealPayloads(meals, createId = createUuid) {
  return (meals ?? []).map((meal, index) => ({
    id: meal.id ?? createId(),
    name: meal.name,
    time_of_day: meal.timeOfDay,
    position: index + 1,
    kcal: meal.kcal,
    protein_g: meal.proteinG,
    carbs_g: meal.carbsG,
    fat_g: meal.fatG,
    alternatives: meal.alternatives || null,
    items: buildMealItemPayloads(meal.items),
  }))
}

/**
 * Freeze every drafted day type into the JSON contract
 * `create_nutrition_plan_secure` consumes: an ordered array of day bundles,
 * each carrying its own meals built the same way `buildMealPayloads`
 * already builds them.
 */
export function buildDayPayloads(days, createId = createUuid) {
  return (days ?? []).map((day, index) => ({
    id: day.id ?? createId(),
    name: day.name,
    position: index + 1,
    weekdays: day.weekdays ?? [],
    meals: buildMealPayloads(day.meals, createId),
  }))
}
