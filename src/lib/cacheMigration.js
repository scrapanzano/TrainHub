// Changing a persisted mutation's function without changing or migrating its
// stored contract can replay yesterday's variables through today's code. Patch
// 015 deliberately changes several write contracts, so the cache carries an
// explicit version and old queued writes are inspected before TanStack Query
// is allowed to restore them.
export const QUERY_CACHE_BUSTER = 'trainhub-security-v4'
export const CACHE_MIGRATION_NOTICE_EVENT = 'trainhub:cache-migration-notice'

const NOTICE_KEY = 'trainhub-cache-migration-notice'

// These operations keep the same variables and server contract after patch
// 015. Everything else is fail-closed: an unknown old key is safer to ask the
// user to repeat than to send silently through a function it was not made for.
export const COMPATIBLE_LEGACY_MUTATIONS = new Set([
  'saveNutritionPlan',
  'saveMeal',
  'deleteMeal',
  'addAvailability',
  'deleteAvailability',
  'sendMessage',
  'chooseProfessional',
])

const mutationName = (mutation) => {
  const key = mutation?.mutationKey
  return Array.isArray(key) ? key[0] : key
}

export function migratePersistedClient(persisted) {
  if (!persisted || persisted.buster === QUERY_CACHE_BUSTER) {
    return { client: persisted, changed: false, discardedCount: 0 }
  }

  const mutations = persisted.clientState?.mutations ?? []
  const compatible = mutations.filter((mutation) =>
    COMPATIBLE_LEGACY_MUTATIONS.has(mutationName(mutation)),
  )

  return {
    changed: true,
    discardedCount: mutations.length - compatible.length,
    client: {
      ...persisted,
      buster: QUERY_CACHE_BUSTER,
      clientState: {
        ...persisted.clientState,
        mutations: compatible,
      },
    },
  }
}

function browserStorage(storage) {
  if (storage) return storage
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function saveMigrationNotice(discardedCount, storage) {
  if (discardedCount === 0) return
  const notice = { version: QUERY_CACHE_BUSTER, discardedCount }
  try {
    browserStorage(storage)?.setItem(
      NOTICE_KEY,
      JSON.stringify(notice),
    )
  } catch {
    // Private mode or a full localStorage must not block cache restoration.
  }

  // The provider restores asynchronously. If the signed-in shell is already
  // visible, its lazy localStorage read has happened, so wake it explicitly.
  if (!storage && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CACHE_MIGRATION_NOTICE_EVENT, { detail: notice }))
  }
}

export function readCacheMigrationNotice(storage) {
  try {
    const raw = browserStorage(storage)?.getItem(NOTICE_KEY)
    if (!raw) return null
    const notice = JSON.parse(raw)
    return notice?.version === QUERY_CACHE_BUSTER && notice.discardedCount > 0
      ? notice
      : null
  } catch {
    return null
  }
}

export function clearCacheMigrationNotice(storage) {
  try {
    browserStorage(storage)?.removeItem(NOTICE_KEY)
  } catch {
    // The notice is advisory. Failure to clear it is not a write failure.
  }
}

/**
 * Wrap the IndexedDB persister so migration happens inside its restore call,
 * before PersistQueryClientProvider can resume any paused mutation.
 */
export function createMigratingPersister(basePersister, storage) {
  return {
    persistClient: (client) => basePersister.persistClient(client),
    removeClient: () => basePersister.removeClient(),
    restoreClient: async () => {
      const persisted = await basePersister.restoreClient()
      const migration = migratePersistedClient(persisted)

      if (migration.changed) {
        // Persist first so the incompatible queue cannot return on refresh.
        // The migrated object is still returned for this launch if IndexedDB
        // rejects the rewrite (private mode, quota, or a transient failure).
        try {
          await basePersister.persistClient(migration.client)
        } catch {
          // Returning the filtered in-memory client remains fail-closed.
        }
        saveMigrationNotice(migration.discardedCount, storage)
      }

      return migration.client
    },
  }
}
