import { logSet, setSessionStatus } from './workouts.js'
import { mutationKeys } from '../lib/mutationKeys.js'
import { queryKeys } from '../lib/queryKeys.js'

/**
 * Teach the query client how to replay each mutation after a reload.
 *
 * Must run BEFORE `PersistQueryClientProvider` restores the cache: restoration
 * resumes paused mutations, and one resumed before its default is registered
 * has no function to call.  `src/App.jsx` calls this at module scope for that
 * reason -- not inside an effect, which would run too late.
 */
export function registerMutationDefaults(queryClient) {
  queryClient.setMutationDefaults(mutationKeys.logSet, {
    mutationFn: logSet,
    // Only the session's own caches are affected, and the summary reads the
    // same logs -- invalidating both keeps them from disagreeing.
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sessionLogs(variables.sessionId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.session(variables.sessionId) })
    },
  })

  queryClient.setMutationDefaults(mutationKeys.setSessionStatus, {
    mutationFn: setSessionStatus,
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.session(variables.sessionId) })
      // The plan screen and Home both render this session's status.
      queryClient.invalidateQueries({ queryKey: ['plan'] })
    },
  })
}
