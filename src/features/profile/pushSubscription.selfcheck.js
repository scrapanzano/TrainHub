import assert from 'node:assert/strict'
import { currentSubscription, pushConfigured, urlBase64ToUint8Array } from './pushSubscription.js'

// `atob` is global in Node 18+, as it is in the browser.

// Padding is re-added: 'AQAB' needs none, 'AQA' needs one '='.
assert.deepEqual(Array.from(urlBase64ToUint8Array('AQAB')), [1, 0, 1])

// base64url's substitutions must be undone, or atob throws.
// '-_8' is base64url for the bytes 0xFB 0xFF.
assert.deepEqual(Array.from(urlBase64ToUint8Array('-_8')), [251, 255])

// A real 65-byte P-256 public key decodes to exactly 65 bytes, and starts with
// the 0x04 uncompressed-point marker.
const key =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
const bytes = urlBase64ToUint8Array(key)
assert.equal(bytes.length, 65)
assert.equal(bytes[0], 4)

// Dev mode exposes the Service Worker API but registers no worker. The old
// `navigator.serviceWorker.ready` path never settled and blocked sign-out.
globalThis.window = { PushManager: class {}, Notification: class {} }
globalThis.Notification = window.Notification
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { serviceWorker: { getRegistration: async () => undefined } },
})
assert.equal(await currentSubscription(), null)
assert.equal(pushConfigured(), false)

console.log('pushSubscription: OK')
