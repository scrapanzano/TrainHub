# Task 5 Report: Member Nutrition Plan and Meal Detail Screens

**Status:** DONE

**Commit:** eb1bc67 – feat(member): add the nutrition plan and meal screens

## Implementation Summary

Implemented two new screens for the member's nutrition journey:

1. **MemberNutritionScreen.jsx** – The nutrition plan view
   - Green macro summary card with plan name, kcal target, and protein/carbs/fats breakdown
   - Decorative week strip (shows every day the same template; selection drives nothing as noted in comment)
   - Daily meals list as clickable cards with meal name, time, and kcal
   - Empty state (wireframe 03B) when trainer has not yet written a plan – shows message and "Book Appointment" button to `/m/trainer/appointments`
   - Proper error and loading states

2. **MealDetailScreen.jsx** – The meal detail view
   - Shows meal name, time, and kcal with full recipe details
   - Lists food items with quantities from the `meal.items` jsonb array
   - Reuses the plan query from cache (no extra read) – member came from plan screen
   - Handles empty items list (trainer has not yet specified meal contents)
   - Handles missing meal (deleted or bad URL) with empty state

3. **Routes wiring** – Replaced two placeholder routes with lazy-loaded imports matching existing patterns

## Verification

**npm run lint:** PASS (exit 0, no output)
```
> trainhub@0.0.0 lint
> eslint .
```

**npm run build:** PASS (build succeeded, 881ms for main build + 110ms for SW)
```
✓ built in 881ms
```

Build output confirmed the two screens were bundled:
- MemberNutritionScreen-CwPqlRsW.js (3.00 kB │ gzip: 1.17 kB)
- MealDetailScreen-DRwIq1kh.js (1.38 kB │ gzip: 0.75 kB)

## Files Changed

- **Created:** `src/features/nutrition/MemberNutritionScreen.jsx` (159 lines)
- **Created:** `src/features/nutrition/MealDetailScreen.jsx` (68 lines)
- **Modified:** `src/routes/index.jsx` (added two lazy route definitions)

## Self-Review Findings

### Adherence to Constraints
- ✓ Plain JS + JSX, no TypeScript
- ✓ ESM module format
- ✓ No new runtime dependencies
- ✓ Styling only via MUI theme (palette.task.nutrition for card background)
- ✓ Error gating on `data === undefined` (not just `isError`)
- ✓ `.retry(navigator.onLine)` inherited from fetchNutritionPlan
- ✓ Proper heading hierarchy: one h1 per screen, h2 for sections, h3 for meal titles
- ✓ No eslint-disable directives
- ✓ ChevronRightIcon verified to exist in codebase (used in ClientDetailScreen et al.)
- ✓ Dates via `todayISO()` from format.js

### Code Quality
- ✓ Decorative week strip documented with intent comment (selection deliberately does nothing)
- ✓ Empty state (null plan) properly implemented per wireframe 03B, not treated as error
- ✓ Meal detail screen efficiently reuses plan query from cache
- ✓ Proper error boundaries and loading states
- ✓ Lazy route imports match existing screen patterns exactly
- ✓ Component composition clean (Macro sub-component for reusable macro display)
- ✓ Meal items array properly guarded (`Array.isArray` check)

### Completeness
- ✓ Implements exact code from brief
- ✓ Uses existing `fetchNutritionPlan` (no new data functions)
- ✓ Uses existing `queryKeys.nutritionPlan`
- ✓ Wires `weekStrip` and `WeekStrip` component per existing patterns
- ✓ Both lint and build pass before commit

## Concerns

None. The implementation is complete, verified, and ready for browser testing by human with database credentials to confirm:
- Member home showing link to `/m/nutrition`
- As Daniel (demo member): `/m/nutrition` displays "Lean Bulk" plan with 2600 kcal and four meals
- Clicking Breakfast navigates to meal detail showing Oats, Whey, Banana with quantities
- As a member with no plan: shows empty state with "You do not have a nutrition plan yet" and booking button
