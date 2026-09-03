// Run with:  node src/features/clients/subscription.selfcheck.js
import assert from 'node:assert/strict'
import { isSubscriptionActive, membershipAction, subscriptionStateOf } from './subscription.js'

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

// --- isSubscriptionActive: the boolean twin of the SQL has_active_subscription
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: '2027-03-31' }, TODAY),
  true,
)
// Close to expiring is still active.
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: '2026-08-20' }, TODAY),
  true,
)
// Elapsed date fails even while the column still says active.
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: '2026-07-28' }, TODAY),
  false,
)
// The boundary: `subscription_until === today` is still active, matching the
// SQL `until >= current_date`. The one input where JS and SQL could diverge.
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: TODAY }, TODAY),
  true,
)
assert.equal(
  isSubscriptionActive({ subscription_status: 'suspended', subscription_until: '2027-01-01' }, TODAY),
  false,
)
assert.equal(
  isSubscriptionActive({ subscription_status: 'expired', subscription_until: '2027-01-01' }, TODAY),
  false,
)
// Open-ended membership and unknown enum are both active; missing profile is not.
assert.equal(
  isSubscriptionActive({ subscription_status: 'active', subscription_until: null }, TODAY),
  true,
)
assert.equal(
  isSubscriptionActive({ subscription_status: 'trialling', subscription_until: null }, TODAY),
  true,
)
assert.equal(isSubscriptionActive(null, TODAY), false)

// --- membershipAction: maps a subscriptionStateOf result to the PT button
const suspend = { label: 'Suspend membership', nextStatus: 'suspended' }
const reactivate = { label: 'Reactivate membership', nextStatus: 'active' }
assert.deepEqual(membershipAction({ label: 'Active', color: 'success.main' }), suspend)
assert.deepEqual(membershipAction({ label: 'Close to Expiring', color: 'warning.main' }), suspend)
assert.deepEqual(membershipAction({ label: 'Suspended', color: 'task.suspended' }), reactivate)
assert.deepEqual(membershipAction({ label: 'Expired', color: 'error.main' }), reactivate)
assert.equal(membershipAction({ label: 'Unknown', color: 'task.suspended' }), null)

console.log('subscription.selfcheck OK')
