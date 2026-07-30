/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// `registerType: 'autoUpdate'` expects the new worker to take over immediately
// rather than waiting for every tab to close.
self.skipWaiting()
clientsClaim()

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Single-page app: every navigation resolves to the precached shell, which is
// what lets a cold start work with no network at all.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// Exercise imagery is immutable and heavy — worth keeping, worth capping.
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'trainhub-images',
    plugins: [new ExpirationPlugin({ maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  }),
)

// Deliberately absent: any caching of Supabase REST responses.  TanStack Query
// already persists that data to IndexedDB (see src/lib/queryClient.js), so a
// second copy here would only add staleness — and a shared cache holding one
// user's data across a sign-out is a leak waiting to happen.

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
  const target = event.notification.data?.url ?? '/'

  // Focus a window that is already open rather than stacking a second one.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.includes(target))
      if (open) return open.focus()
      return self.clients.openWindow(target)
    }),
  )
})
