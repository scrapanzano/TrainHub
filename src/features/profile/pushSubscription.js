// Imported dynamically at point of use below, not statically here: a static
// import would pull in `data/push.js` -> `lib/supabase.js` for every consumer
// of this module, including `pushSubscription.selfcheck.js`, which runs under
// plain `node` where `import.meta.env` does not exist and that module throws
// at load time.

/**
 * VAPID keys are published as base64url; `pushManager.subscribe` wants raw
 * bytes. base64url swaps `+/` for `-_` and drops the padding, so neither the
 * substitution nor the padding can be skipped -- `atob` rejects the string
 * outright without them.
 */
export function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalised)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

/** True when this browser can do Web Push at all. */
export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** This device's current subscription, or null. */
export async function currentSubscription() {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

/**
 * Subscribe this device.
 *
 * MUST be called from a user gesture: iOS refuses a permission request that did
 * not come from one, without even showing the dialog. iOS also requires the PWA
 * to have been installed to the Home Screen from Safari -- Web Push does not
 * exist for a site open in a browser tab there.
 */
export async function enablePush(userId) {
  if (!pushSupported()) throw new Error('This browser does not support notifications.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site.')

  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      // Chrome refuses a subscription that might deliver silently.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY),
    }))

  const { savePushSubscription } = await import('../../data/push.js')
  await savePushSubscription({ userId, subscription })
  return subscription
}

/**
 * Unsubscribe this device and forget the row.
 *
 * The local unsubscribe is in a `finally` so it happens even when the delete
 * throws -- which offline it always does, and sign-out swallows that by design.
 * Row-first-only left the departed user's phone still receiving their
 * notifications, the exact failure this call exists to prevent, and blocked the
 * next person to sign in on it: `enablePush` reuses the live subscription and
 * the upsert then collides with an `endpoint` row that `push_subscriptions_all`
 * makes neither visible nor writable to them.
 *
 * The orphaned row is self-cleaning: a dead endpoint answers 410 and the Edge
 * Function prunes it.
 */
export async function disablePush() {
  const subscription = await currentSubscription()
  if (!subscription) return
  try {
    const { deletePushSubscription } = await import('../../data/push.js')
    await deletePushSubscription(subscription.endpoint)
  } finally {
    await subscription.unsubscribe()
  }
}
