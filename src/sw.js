/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

// `registerType: 'autoUpdate'` expects the new worker to take over immediately
// rather than waiting for every tab to close.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Single-page app: every navigation resolves to the precached shell, which is
// what lets a cold start work with no network at all.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Deliberately absent: any caching of Supabase REST responses.  TanStack Query
// already persists that data to IndexedDB (see src/lib/queryClient.js), so a
// second copy here would only add staleness — and a shared cache holding one
// user's data across a sign-out is a leak waiting to happen. Images are left to
// ordinary HTTP caching for the same reason: profile photos can be user data.

// Push arrives when no page of ours is running, which is the whole point of the
// feature: the service worker is the only thing alive to show it.
self.addEventListener('push', (event) => {
  // A push whose payload will not parse still has to show something, because
  // Chrome shows its own "This site has been updated in the background" notice
  // if the handler ends without one.
  let payload = { title: 'TrainHub', body: '', url: '/' }
  try {
    payload = { ...payload, ...event.data.json() }
  } catch {
    // Keep the default.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { url: payload.url },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // `openWindow` is not restricted to this worker's scope, so an absolute URL in
  // the payload would open an attacker's page carrying TrainHub's icon. Resolve
  // against our own origin and refuse anything that lands elsewhere.
  let target = new URL('/', self.location.origin)
  try {
    const candidate = new URL(event.notification.data?.url ?? '/', self.location.origin)
    if (candidate.origin === self.location.origin) target = candidate
  } catch {
    // Keep the default.
  }

  // Focus a window that is already open rather than stacking a second one,
  // navigating it to the tap target first. Matching by pathname equality (the
  // earlier fix for `String.includes` matching every open window whenever the
  // target was '/') still opens a second window in the common case: the app
  // sitting on '/m' does not equal a chat notification's '/m/trainer/chat', so
  // no open window matched. Any open window is close enough — navigate it,
  // then focus it — and only `openWindow` when there is no window at all.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const [open] = windows
      if (open) return open.navigate(target.href).then((client) => (client ?? open).focus())
      return self.clients.openWindow(target.href)
    }),
  )
})
