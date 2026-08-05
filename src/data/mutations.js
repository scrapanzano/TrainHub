import {
  addSessionExercise, createPlan, createSession, deleteSession, deleteSessionExercise, logSet,
} from './workouts.js'
import { endRun, pauseRun, resumeRun, saveRunNote, startRun } from './runs.js'
import { awardReward } from './rewards.js'
import { deleteMeal, saveMeal, saveNutritionPlan } from './nutrition.js'
import { saveBodyMetric } from './progress.js'
import { createAppointment, setAppointmentStatus } from './appointments.js'
import { addAvailability, deleteAvailability } from './availability.js'
import { ensureThread, markThreadRead, sendMessage } from './chat.js'
import { chooseProfessional } from './profile.js'
import { mutationKeys } from '../lib/mutationKeys.js'
import { queryKeys, queryPrefixes } from '../lib/queryKeys.js'

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
  // One scope across a whole workout.  `set_logs.run_id` is a foreign key, so
  // the run must land before any of its sets, and pause/resume/end must land in
  // the order they happened.  `resumePausedMutations` replays in parallel
  // unless a scope says otherwise, so without this the reconnect after a
  // session logged underground fails on the constraint and the sets are lost.
  const runScope = { id: 'workoutRun' }

  queryClient.setMutationDefaults(mutationKeys.logSet, {
    mutationFn: logSet,
    scope: runScope,
    // Invalidate the families rather than one id: prefix matching cannot be
    // defeated by a caller that omits the id, and at this cache size -- one
    // member's own sessions -- the extra refetches are negligible.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
      // The pills, the plan bar and the congratulations dialog all read the
      // run's logs.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.startRun, {
    mutationFn: startRun,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      // The plan screen derives every session's state from these runs.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.pauseRun, {
    mutationFn: pauseRun,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.resumeRun, {
    mutationFn: resumeRun,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.endRun, {
    mutationFn: endRun,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  // Written on the summary, after the run has closed, so it carries no
  // ordering obligation against the sets -- but it shares the scope anyway:
  // a note replayed before the `endRun` that closed the run would be
  // overwritten by `endRun`'s own null note.
  queryClient.setMutationDefaults(mutationKeys.saveRunNote, {
    mutationFn: saveRunNote,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.clientTraining })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.awardReward, {
    mutationFn: awardReward,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.rewards })
    },
  })

  // `createPlan` and `createSession` share a scope so a replay cannot land a
  // session before the plan it belongs to -- `CreatePlanFlow` fires both at
  // once precisely so neither depends on a per-call callback surviving a
  // reload, and only an ordered replay makes that safe.
  //
  // It serialises two adds to the same plan as a bonus: `position` is
  // `Math.max(...) + 1` read from cache, so two sessions added in parallel
  // would compute the same position and the second would be rejected by
  // `unique (plan_id, position)`.
  const planWriteScope = { id: 'planWrite' }

  queryClient.setMutationDefaults(mutationKeys.createSession, {
    mutationFn: createSession,
    scope: planWriteScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.createPlan, {
    mutationFn: createPlan,
    scope: planWriteScope,
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

  // Shares the session-write scope with the delete below: `position` is
  // `Math.max(...) + 1` computed from cache, so two adds replayed in parallel
  // would land on the same position and `unique (session_id, position)` would
  // reject the second.
  queryClient.setMutationDefaults(mutationKeys.addSessionExercise, {
    mutationFn: addSessionExercise,
    scope: { id: 'sessionExercises' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteSessionExercise, {
    mutationFn: deleteSessionExercise,
    scope: { id: 'sessionExercises' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
      // The plan screen prints each session's exercise count.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
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
      // The professional's own sheet only ever needed `agenda`. Now the
      // member's booking sheet calls this too, and the member's queries are
      // `appointments`-prefixed -- without this the new booking would not
      // show up until the 30s staleTime lapsed and something else triggered
      // a refetch.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.appointments })
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

    // Show the message the instant it is sent.  Offline the write pauses and
    // never settles, so without this the composer clears and NOTHING appears --
    // the message is invisible until reconnect.  Registered here, like every
    // other write in this file, so the persister can find `mutationFn` again
    // after a reload -- but the optimistic row surviving that reload is the
    // persisted query cache's doing, not this hook's: a rehydrated pending
    // mutation resumes through `retryer.continue()` and never re-enters
    // `execute`, so `onMutate` does not run a second time for it (see
    // `@tanstack/query-core`'s `mutation.js`, the `restored` branch of `execute`).
    //
    // The caller already supplies the row's id, and the Realtime handler in
    // `useThreadMessages.js` dedupes on that same id, so the server's echo of
    // this row is a no-op rather than a duplicate.
    //
    // No rollback: a paused send that later fails permanently leaves this row
    // behind until the next refetch drops it, which is the better trade than
    // deleting a message a user believes they sent.
    onMutate: async ({ id, threadId, senderId, body }) => {
      // `useThreadMessages.js` invalidates the whole `['chat']` prefix on every
      // incoming Realtime message, so a `threadMessages` refetch is often in
      // flight; without this a send inside that window has its optimistic row
      // overwritten when the fetch resolves.
      await queryClient.cancelQueries({ queryKey: queryKeys.threadMessages(threadId) })

      queryClient.setQueryData(queryKeys.threadMessages(threadId), (current) => {
        // Undefined means the first fetch has not landed; there is nothing to
        // append to, and that fetch will include this row anyway.
        if (!current) return current
        return [
          ...current,
          {
            id,
            thread_id: threadId,
            sender_id: senderId,
            body,
            read_at: null,
            // Local clock, unlike the real row, whose `created_at` is the column
            // default -- close enough to keep this at the end of the list, which
            // is all it is used for here.
            created_at: new Date().toISOString(),
          },
        ]
      })
    },

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

  queryClient.setMutationDefaults(mutationKeys.ensureThread, {
    mutationFn: ensureThread,
    // Same scope as its two siblings: the thread must exist before a queued send
    // or read-receipt for it replays.
    scope: { id: 'chat' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.chooseProfessional, {
    mutationFn: chooseProfessional,
    onSettled: () => {
      // A different professional means a different thread, so the whole chat
      // family is stale -- the member's thread lookup, its messages and the
      // unread badge.
      //
      // What this canNOT refresh is the member's own profile: AuthProvider
      // holds it outside the query cache, so `assigned_pro_id` in the shell
      // stays stale until the app reloads. The call site does that reload; see
      // the note there and in "Deferred beyond Phase 4".
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })
}
