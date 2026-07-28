import { logSet, setSessionStatus } from './workouts.js'
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
    // Only the session's own caches are affected, and the summary reads the
    // same logs -- invalidating both keeps them from disagreeing.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryPrefixes.sessionLogs })
      queryClient.invalidateQueries({ queryKey: queryPrefixes.session })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.setSessionStatus, {
    mutationFn: setSessionStatus,
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
}
