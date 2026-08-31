/**
 * Create an RFC 4122 version-4 UUID in secure and local-network contexts.
 *
 * `crypto.randomUUID()` is restricted to secure contexts, so an otherwise
 * working preview opened through `http://192.168.x.x` can lose the method.
 * `getRandomValues()` remains the cryptographic primitive available there.
 */
export function createUuid(source = globalThis.crypto) {
  if (typeof source?.randomUUID === 'function') return source.randomUUID()
  if (typeof source?.getRandomValues !== 'function') {
    throw new Error('This browser cannot create a secure identifier.')
  }

  const bytes = new Uint8Array(16)
  source.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}
