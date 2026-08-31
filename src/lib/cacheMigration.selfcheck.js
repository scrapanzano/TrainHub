// Run with: node src/lib/cacheMigration.selfcheck.js
import assert from 'node:assert/strict'
import {
  QUERY_CACHE_BUSTER,
  clearCacheMigrationNotice,
  createMigratingPersister,
  migratePersistedClient,
  readCacheMigrationNotice,
} from './cacheMigration.js'

const oldClient = {
  timestamp: 1,
  buster: '',
  clientState: {
    queries: [{ queryKey: ['plan', 'member-1'] }],
    mutations: [
      { mutationKey: ['createPlan'], state: { isPaused: true } },
      { mutationKey: ['sendMessage'], state: { isPaused: true } },
      { mutationKey: ['markThreadRead'], state: { isPaused: true } },
      { mutationKey: ['unknownOldWrite'], state: { isPaused: true } },
    ],
  },
}

const migrated = migratePersistedClient(oldClient)
assert.equal(migrated.changed, true)
assert.equal(migrated.discardedCount, 3)
assert.equal(migrated.client.buster, QUERY_CACHE_BUSTER)
assert.deepEqual(migrated.client.clientState.queries, oldClient.clientState.queries)
assert.deepEqual(
  migrated.client.clientState.mutations.map((mutation) => mutation.mutationKey),
  [['sendMessage']],
)
assert.equal(migratePersistedClient(migrated.client).changed, false)
assert.deepEqual(migratePersistedClient(null), {
  client: null,
  changed: false,
  discardedCount: 0,
})

const values = new Map()
const noticeStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}
let stored = oldClient
let persistCount = 0
const memoryPersister = {
  restoreClient: async () => stored,
  persistClient: async (client) => {
    stored = client
    persistCount += 1
  },
  removeClient: async () => {
    stored = undefined
  },
}

const persister = createMigratingPersister(memoryPersister, noticeStorage)
const restored = await persister.restoreClient()
assert.equal(restored.buster, QUERY_CACHE_BUSTER)
assert.equal(persistCount, 1)
assert.deepEqual(readCacheMigrationNotice(noticeStorage), {
  version: QUERY_CACHE_BUSTER,
  discardedCount: 3,
})

// A second restore is already current: it neither rewrites nor duplicates the
// notice, which makes the migration genuinely one-shot.
await persister.restoreClient()
assert.equal(persistCount, 1)
clearCacheMigrationNotice(noticeStorage)
assert.equal(readCacheMigrationNotice(noticeStorage), null)

console.log('cacheMigration self-check PASS')
