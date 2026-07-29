import { createPlan, createSession, deleteSession, logSet, setSessionStatus } from './workouts.js'
import { awardReward } from './rewards.js'
import { deleteMeal, saveMeal, saveNutritionPlan } from './nutrition.js'
import { saveBodyMetric } from './progress.js'
import { createAppointment, setAppointmentStatus } from './appointments.js'
import { addAvailability, deleteAvailability } from './availability.js'
import { markThreadRead, sendMessage } from './chat.js'
import { mutationKeys } from '../lib/mutationKeys.js'
import { queryPrefixes } from '../lib/queryKeys.js'

/**
 * Teach the query client how to replay each mutation after a reload.
 *
 * Must run BEFORE `PersistQueryClientProvider` restores the cache: restoration
 * resumes paused mutations, and one resumed before its default is registered
 * has no function to call.  `src/App.jsx` calls this at module scope for that
 * reason -- not inside an effect, which would run too late.
 *
 * Call sites must NOT declare `onSettled` in their own `useMutation` options:
 * `defaultMutationOptions` spreads the call site last, so it would REPLACE the
 * handler registered here rather than run alongside it, and the invalidations
 * below would silently stop firing online while still working on replay.
 * Per-call `mutate(vars, { onSuccess })` callbacks are a different mechanism and
 * are safe -- those run in addition, not instead.
 */
export function registerMutationDefaults(queryClient) {
  queryClient.setMutationDefaults(mutationKeys.logSet, {
    mutationFn: logSet,
    // Invalidate the families rather than one id: prefix matching cannot be
    // defeated by a caller that omits the id, and at this cache size -- one
    // member's own sessions -- the extra refetches are negligible.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.sessionLogs })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.setSessionStatus, {
    mutationFn: setSessionStatus,
    // Serialise replays.  `resumePausedMutations` runs paused mutations in
    // parallel unless they share a scope, and this key queues an ordered pair
    // -- `in_progress` on start, `completed` on stop.  Unordered, the last PATCH
    // to land wins by luck and a finished workout can persist as unfinished.
    scope: { id: 'sessionStatus' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
      // The plan screen and Home both render this session's status.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.awardReward, {
    mutationFn: awardReward,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.rewards })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.createSession, {
    mutationFn: createSession,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.createPlan, {
    mutationFn: createPlan,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
      // `fetchClients` derives each roster row's `goal` from the client's
      // newest `workout_plans` row, so the roster goes stale the moment a new
      // plan is created unless this family is invalidated too.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.clients })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteSession, {
    mutationFn: deleteSession,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
    },
  })

  // Scoped for the same reason as `saveMeal` below: two edits to the same plan
  // replayed in parallel land in whichever order the network settles them, and
  // the older can win.
  queryClient.setMutationDefaults(mutationKeys.saveNutritionPlan, {
    mutationFn: saveNutritionPlan,
    scope: { id: 'nutritionPlan' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.nutritionPlan })
    },
  })

  // Meals share a scope so replays run in insertion order.  Without it,
  // `resumePausedMutations` replays in parallel and two edits to the same meal
  // land in whichever order the network settles them -- the older one can win.
  queryClient.setMutationDefaults(mutationKeys.saveMeal, {
    mutationFn: saveMeal,
    scope: { id: 'meals' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.nutritionPlan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteMeal, {
    mutationFn: deleteMeal,
    scope: { id: 'meals' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.nutritionPlan })
    },
  })

  // Scoped because the write upserts on `(member_id, measured_on)`: two saves
  // for the same client on the same day target the same row, so replays must
  // run in order rather than racing.
  queryClient.setMutationDefaults(mutationKeys.saveBodyMetric, {
    mutationFn: saveBodyMetric,
    scope: { id: 'bodyMetric' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.bodyMetrics })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.createAppointment, {
    mutationFn: createAppointment,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.agenda })
    },
  })

  // Scoped so replays run serially.  Two status changes to the same appointment
  // -- confirm then complete -- replayed in parallel land in whichever order the
  // network settles them, and the earlier one can win.
  queryClient.setMutationDefaults(mutationKeys.setAppointmentStatus, {
    mutationFn: setAppointmentStatus,
    scope: { id: 'appointmentStatus' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.agenda })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.appointment })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.addAvailability, {
    mutationFn: addAvailability,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.availability })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteAvailability, {
    mutationFn: deleteAvailability,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.availability })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.sendMessage, {
    mutationFn: sendMessage,
    // Serialise replays.  Messages are the one thing in this app whose ORDER is
    // the content: two queued sends replayed in parallel can land out of order
    // and the conversation reads wrong.
    scope: { id: 'chat' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markThreadRead, {
    mutationFn: markThreadRead,
    scope: { id: 'chat' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })
}
