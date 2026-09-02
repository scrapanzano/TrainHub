import assert from 'node:assert/strict'
import { createUuid } from './uuid.js'

const native = '7f911783-cd91-4a4c-b25f-271ade4dcc44'
assert.equal(createUuid({ randomUUID: () => native }), native)

const fallback = createUuid({
  getRandomValues(bytes) {
    bytes.forEach((_, index) => { bytes[index] = index })
    return bytes
  },
})
assert.equal(fallback, '00010203-0405-4607-8809-0a0b0c0d0e0f')
assert.match(fallback, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
assert.throws(() => createUuid({}), /cannot create a secure identifier/)

console.log('uuid.selfcheck OK')
