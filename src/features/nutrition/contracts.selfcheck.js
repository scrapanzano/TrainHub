// Run with: node src/features/nutrition/contracts.selfcheck.js
import assert from 'node:assert/strict'
import { buildDayPayloads, buildMealItemPayloads, buildMealPayloads } from './contracts.js'

// --- buildMealItemPayloads --------------------------------------------------
assert.deepEqual(buildMealItemPayloads([{ food: '  Oats  ', qty: '80 g' }]), [
  { food: 'Oats', qty: '80 g' },
])
// A blank food row is a user-added-then-abandoned row, not real data.
assert.deepEqual(buildMealItemPayloads([{ food: '   ', qty: '80 g' }]), [])
assert.deepEqual(buildMealItemPayloads([{ food: 'Rice' }]), [{ food: 'Rice', qty: '' }])
assert.deepEqual(buildMealItemPayloads([]), [])
assert.deepEqual(buildMealItemPayloads(undefined), [])

// --- buildMealPayloads -------------------------------------------------------
let nextId = 0
const createId = () => `meal-${++nextId}`
const draftMeals = [
  { name: 'Breakfast', timeOfDay: '07:30', kcal: 500, proteinG: 30, carbsG: 60, fatG: 15,
    alternatives: '', items: [{ food: 'Oats', qty: '80 g' }] },
  { id: 'stable-meal', name: 'Lunch', timeOfDay: '13:00', kcal: 800, proteinG: null,
    carbsG: null, fatG: null, alternatives: 'Farro instead of rice', items: [] },
]

assert.deepEqual(buildMealPayloads(draftMeals, createId), [
  {
    id: 'meal-1', name: 'Breakfast', time_of_day: '07:30', position: 1, kcal: 500,
    protein_g: 30, carbs_g: 60, fat_g: 15, alternatives: null,
    items: [{ food: 'Oats', qty: '80 g' }],
  },
  {
    id: 'stable-meal', name: 'Lunch', time_of_day: '13:00', position: 2, kcal: 800,
    protein_g: null, carbs_g: null, fat_g: null, alternatives: 'Farro instead of rice',
    items: [],
  },
])
// A meal missing an id gets one from the factory; a supplied id is kept and
// the factory is not called for it.
assert.equal(nextId, 1)
assert.deepEqual(buildMealPayloads([], createId), [])
assert.deepEqual(buildMealPayloads(undefined), [])

// --- buildDayPayloads ---------------------------------------------------------
// Every meal here already carries a stable id, so nesting them inside a day
// exercises buildDayPayloads' own id/position generation in isolation from
// buildMealPayloads' -- the meal-level factory calls above stay predictable.
const stableMeals = [
  { id: 'm1', name: 'Breakfast', timeOfDay: '07:30', kcal: 500, proteinG: 30, carbsG: 60,
    fatG: 15, alternatives: '', items: [] },
]
const days = [
  { name: 'Day A', weekdays: [1, 3, 5], meals: stableMeals },
  { id: 'stable-day', name: 'Day B', weekdays: [0, 2, 4, 6], meals: [] },
]

const dayCreateId = (() => {
  let n = 0
  return () => `day-${++n}`
})()
const builtDays = buildDayPayloads(days, dayCreateId)
assert.equal(builtDays.length, 2)
assert.equal(builtDays[0].id, 'day-1')
assert.equal(builtDays[0].position, 1)
assert.equal(builtDays[1].id, 'stable-day')
assert.equal(builtDays[1].position, 2)
assert.deepEqual(builtDays[1].weekdays, [0, 2, 4, 6])
assert.deepEqual(builtDays[1].meals, [])
// The nested meal is frozen through the same buildMealPayloads shape a
// standalone call produces -- {id, name, time_of_day, ...}, snake_case keys,
// position renumbered from its index inside the day.
assert.deepEqual(builtDays[0].meals, [
  {
    id: 'm1', name: 'Breakfast', time_of_day: '07:30', position: 1, kcal: 500,
    protein_g: 30, carbs_g: 60, fat_g: 15, alternatives: null, items: [],
  },
])
assert.deepEqual(buildDayPayloads([], dayCreateId), [])
assert.deepEqual(buildDayPayloads(undefined), [])
// A day missing `weekdays` entirely defaults to an empty array rather than
// throwing -- the RPC's own "needs at least one weekday" check is what
// rejects this, not a client-side crash.
assert.deepEqual(
  buildDayPayloads([{ id: 'no-weekdays', name: 'No weekdays', meals: [] }], dayCreateId)[0].weekdays,
  [],
)

console.log('nutrition contracts: OK')
