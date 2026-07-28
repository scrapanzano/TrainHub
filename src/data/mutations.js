import { createSession, logSet, setSessionStatus } from './workouts.js'
import { awardReward } from './rewards.js'
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
}
