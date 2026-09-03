import { createPlan, logSet } from './workouts.js'
import { endRun, pauseRun, resumeRun, saveRunNote, startRun } from './runs.js'
import { createNutritionPlan } from './nutrition.js'
import { saveBodyMetric } from './progress.js'
import { createAppointment, setAppointmentStatus } from './appointments.js'
import { setSubscriptionStatus } from './clients.js'
import { addAvailability, deleteAvailability } from './availability.js'
import { ensureThread, markThreadRead, sendMessage } from './chat.js'
import { chooseProfessional } from './profile.js'
import {
  deleteAllNotifications, deleteNotification, deleteNotificationsByIds, markAllNotificationsRead,
  markNotificationRead, markNotificationsRead, markNotificationsReadByIds,
} from './notifications.js'
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
    // The open run must exist in the cache the instant play is pressed, not
    // when the server answers.  The live screen redirects away when it finds no
    // open run for its session, so without this the member is bounced straight
    // back: guaranteed offline, and a race the navigation usually wins online.
    onMutate: (variables) => {
      queryClient.setQueryData(queryKeys.openRun(variables.memberId), {
        id: variables.id,
        session_id: variables.sessionId,
        member_id: variables.memberId,
        started_at: variables.startedAt,
        paused_at: null,
        paused_total_ms: 0,
        ended_at: null,
        outcome: null,
        pct: null,
        note: null,
        // The caller passes the name so the mini-player has something to say
        // before the refetch lands.
        session: { id: variables.sessionId, name: variables.sessionName ?? 'Workout' },
      })
      // A fresh run has logged nothing.  Seeded rather than left missing so the
      // pills read 0/3 immediately instead of waiting on a request that will
      // not go out at all while offline.
      queryClient.setQueryData(queryKeys.runLogs(variables.id), [])
    },
    onError: (_error, variables) => {
      // The run never opened.  Leaving it in the cache would show a mini-player
      // for a workout that does not exist and block starting a real one.
      const current = queryClient.getQueryData(queryKeys.openRun(variables.memberId))
      if (current?.id === variables.id) {
        queryClient.setQueryData(queryKeys.openRun(variables.memberId), null)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      // The plan screen derives every session's state from these runs.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.pauseRun, {
    mutationFn: pauseRun,
    onSuccess: (data, variables) => {
      const current = queryClient.getQueryData(queryKeys.openRun(variables.memberId))
      if (current?.id === variables.id) {
        queryClient.setQueryData(queryKeys.openRun(variables.memberId), { ...current, ...data })
      }
    },
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.resumeRun, {
    mutationFn: resumeRun,
    onSuccess: (data, variables) => {
      const current = queryClient.getQueryData(queryKeys.openRun(variables.memberId))
      if (current?.id === variables.id) {
        queryClient.setQueryData(queryKeys.openRun(variables.memberId), { ...current, ...data })
      }
    },
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.endRun, {
    mutationFn: endRun,
    scope: runScope,
    // The mirror of `startRun`'s problem.  Offline this write pauses, so
    // without closing the run in the cache here the mini-player would go on
    // counting a workout the member has already finished, and pressing play on
    // anything else would raise "a workout is already open" about it.
    //
    // It also seeds the summary.  That screen reads the run by id, a key
    // nothing has ever populated, so finishing a workout offline would land on
    // an empty screen instead of the numbers just earned.
    onMutate: (variables) => {
      const open = queryClient.getQueryData(queryKeys.openRun(variables.memberId))
      const closed = {
        ...(open ?? { id: variables.id, session_id: variables.sessionId }),
        id: variables.id,
        ended_at: variables.endedAt,
        outcome: variables.outcome,
        pct: variables.pct ?? null,
        server_confirmed: false,
      }

      queryClient.setQueryData(queryKeys.run(variables.id), closed)
      // Only clear the shell's run if the one being closed IS the open one: a
      // replay arriving after the member has started something else must not
      // wipe the workout they are in the middle of now.
      if (open?.id === variables.id) {
        queryClient.setQueryData(queryKeys.openRun(variables.memberId), null)
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.run(data.id), data)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
      // Closing the run creates its reward in the same database transaction.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.rewards })
    },
  })

  // Written on the summary, after the run has closed.  `endRun` deliberately
  // does not touch `note`, so there is nothing here for it to overwrite -- but
  // the scope is shared anyway so a note cannot reach the server ahead of the
  // run it belongs to, which offline is a real ordering and not a theoretical
  // one.
  queryClient.setMutationDefaults(mutationKeys.saveRunNote, {
    mutationFn: saveRunNote,
    scope: runScope,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.runs })
      // `fetchActivePlan` embeds the run rows too, including their notes.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
    },
  })

  // A plan's whole write -- itself and every drafted session -- is one
  // atomic RPC call (patches/018), so this no longer shares a scope with a
  // sibling mutation the way it did when a session was a second, separate
  // write. Kept regardless: if a member somehow queues two plan creations
  // offline, replaying them in order is still the safer default over racing.
  queryClient.setMutationDefaults(mutationKeys.createPlan, {
    mutationFn: createPlan,
    scope: { id: 'planWrite' },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.plan })
      // `fetchClients` derives each roster row's `goal` from the client's
      // newest `workout_plans` row, so the roster goes stale the moment a new
      // plan is created unless this family is invalidated too.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.clients })
    },
  })

  // Scoped for the same reason as `createPlan` above: create_nutrition_plan_
  // secure carries the same optimistic-concurrency check (`the member plan
  // changed before this save arrived`) and the same "replaced at most once"
  // unique index, so two creations replayed in parallel could have the
  // replacement land before the plan it replaces.
  queryClient.setMutationDefaults(mutationKeys.createNutritionPlan, {
    mutationFn: createNutritionPlan,
    scope: { id: 'nutritionPlanWrite' },
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

  // Flip a client's membership status. Scoped so two rapid toggles
  // (suspend then reactivate) replay in the order they were clicked rather
  // than racing. No client-generated id: the write is an absolute-value
  // UPDATE keyed by member_id, a no-op on replay.
  queryClient.setMutationDefaults(mutationKeys.setSubscriptionStatus, {
    mutationFn: setSubscriptionStatus,
    scope: { id: 'subscriptionStatus' },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.clients })
      queryClient.invalidateQueries({ queryKey: queryKeys.client(variables.memberId) })
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
      // `chooseProfessional` also publishes its returned full profile to
      // AuthProvider. That happens inside the durable mutation function, so a
      // restored offline choice refreshes the shell too.
      queryClient.invalidateQueries({ queryKey: queryPrefixes.chat })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markNotificationRead, {
    mutationFn: markNotificationRead,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markNotificationsRead, {
    mutationFn: markNotificationsRead,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteNotification, {
    mutationFn: deleteNotification,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markNotificationsReadByIds, {
    mutationFn: markNotificationsReadByIds,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteNotificationsByIds, {
    mutationFn: deleteNotificationsByIds,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.markAllNotificationsRead, {
    mutationFn: markAllNotificationsRead,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.deleteAllNotifications, {
    mutationFn: deleteAllNotifications,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.notifications })
    },
  })

  // A paused mutation restored without a registered function is discarded by
  // TanStack Query. Fail loudly during bootstrap if a future key is added at a
  // call site but forgotten here, instead of losing that user's offline write.
  const missing = Object.entries(mutationKeys)
    .filter(([, key]) => typeof queryClient.getMutationDefaults(key).mutationFn !== 'function')
    .map(([name]) => name)
  if (missing.length > 0) {
    throw new Error(`Missing durable mutation defaults: ${missing.join(', ')}`)
  }
}
