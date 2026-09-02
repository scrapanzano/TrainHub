import { QueryClient } from '@tanstack/react-query'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { del, get, set } from 'idb-keyval'
import { createMigratingPersister } from './cacheMigration.js'

const ONE_WEEK = 1000 * 60 * 60 * 24 * 7

// How long a restored cache stays valid.  Exported so `persistOptions` uses
// this exact value instead of a second hand-written copy that could drift.
export const CACHE_MAX_AGE = ONE_WEEK

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // gcTime must not be shorter than CACHE_MAX_AGE: an inactive query
      // evicted from memory first can never be restored, and persistence
      // silently does nothing.
      gcTime: ONE_WEEK,
      staleTime: 1000 * 30,
      // Retrying while offline pauses the query instead of failing it, so
      // `isPending` would stay true forever and no screen could ever show its
      // offline state.  Fail fast when the browser already knows there is no
      // network; `refetchOnReconnect` picks it back up.
      retry: (failureCount) => navigator.onLine && failureCount < 2,
      refetchOnWindowFocus: false,
      // Serve cached data immediately and only then reach for the network,
      // instead of failing fast when offline.
      networkMode: 'offlineFirst',
    },
    mutations: {
      // Offline mutations pause and persist rather than error.  Phase 2 pairs
      // this with setMutationDefaults + resumePausedMutations to replay them.
      networkMode: 'offlineFirst',
      retry: 3,
    },
  },
})

const indexedDbPersister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'trainhub-query-cache',
  throttleTime: 1000,
})

export const persister = createMigratingPersister(indexedDbPersister)
