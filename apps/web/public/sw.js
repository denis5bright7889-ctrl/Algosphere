/**
 * AlgoSphere Quant — Web Push service worker.
 * Handles incoming pushes + notification click-to-navigate.
 */

self.addEventListener('install', (event) => {
  // Activate immediately on update so users get latest behavior
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* non-JSON */ }

  const title = data.title || 'AlgoSphere'
  const body  = data.body  || ''
  const url   = data.url   || '/overview'
  const tag   = data.tag   || `algosphere-${Date.now()}`

  const options = {
    body,
    icon:    '/icon.png',
    badge:   '/icon.png',
    tag,                    // collapses duplicates with the same tag
    renotify: false,
    data:    { url },
    vibrate: [80, 40, 80],
    requireInteraction: data.urgent === true,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/overview'

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Focus an existing tab if open
    for (const c of clients) {
      if (c.url.includes(target.split('?')[0])) { return c.focus() }
    }
    if (clients[0]) {
      await clients[0].focus()
      return clients[0].navigate(target)
    }
    return self.clients.openWindow(target)
  })())
})
