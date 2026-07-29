// Run with:  node src/features/clients/subscription.selfcheck.js
import assert from 'node:assert/strict'
import { subscriptionStateOf } from './subscription.js'

const TODAY = '2026-07-29'

// A comfortable renewal date is plain "Active".
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2027-03-31' }, TODAY),
  { label: 'Active', color: 'success.main' },
)

// Inside 30 days it becomes the amber warning the roster wireframe draws.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-08-20' }, TODAY),
  { label: 'Close to Expiring', color: 'warning.main' },
)

// The boundary is inclusive at 30 and exclusive at 31, checked from both sides
// so an off-by-one cannot pass.
assert.equal(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-08-28' }, TODAY).label,
  'Close to Expiring',
)
assert.equal(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-08-29' }, TODAY).label,
  'Active',
)

// A date that has already gone by outranks the stored status: the column is
// only correct until the day it stops being correct, and nothing sweeps it.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: '2026-07-28' }, TODAY),
  { label: 'Expired', color: 'error.main' },
)
// Today itself is still valid.
assert.equal(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: TODAY }, TODAY).label,
  'Close to Expiring',
)

// An explicit status wins over any date arithmetic.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'suspended', subscription_until: '2027-01-01' }, TODAY),
  { label: 'Suspended', color: 'task.suspended' },
)
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'expired', subscription_until: '2027-01-01' }, TODAY),
  { label: 'Expired', color: 'error.main' },
)

// No renewal date at all is an open-ended membership, not an expired one.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'active', subscription_until: null }, TODAY),
  { label: 'Active', color: 'success.main' },
)

// An unknown enum value must not crash a list of clients.
assert.deepEqual(
  subscriptionStateOf({ subscription_status: 'trialling', subscription_until: null }, TODAY),
  { label: 'Active', color: 'success.main' },
)
// Neither must a missing profile.
assert.deepEqual(subscriptionStateOf(null, TODAY), { label: 'Unknown', color: 'task.suspended' })

console.log('subscription.selfcheck OK')
