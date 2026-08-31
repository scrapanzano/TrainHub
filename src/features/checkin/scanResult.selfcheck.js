// Run with: node src/features/checkin/scanResult.selfcheck.js
import assert from 'node:assert/strict'
import { scanResultView } from './scanResult.js'

assert.equal(scanResultView({ status: 'ok', full_name: 'Daniel' }).accepted, true)

for (const status of ['unknown', 'used', 'expired', 'suspended', 'error']) {
  const view = scanResultView({ status })
  assert.equal(view.accepted, false, `${status} must never render as accepted`)
}

for (const status of ['expired', 'suspended']) {
  assert.match(scanResultView({ status }).message, /No check-in was recorded/)
}

assert.equal(
  scanResultView({ status: 'error', message: 'Network unavailable' }).message,
  'Network unavailable',
)

console.log('scanner result: OK')
