// Notification handling, loaded into the Workbox service worker (see workbox.importScripts in vite.config.ts).
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const scope = self.registration.scope
  event.waitUntil(
    self.registration.showNotification(data.title || 'Realtynmore', {
      body: data.body || 'New story on Realty & More',
      icon: scope + 'icons/icon-192.png',
      badge: scope + 'icons/badge-96.png',
      image: data.image,
      tag: data.tag || 'rnm-news',
      data: { url: scope + (data.url || '') },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((c) => c.url.startsWith(self.registration.scope))
      if (open) return open.focus().then((c) => c.navigate(url))
      return self.clients.openWindow(url)
    }),
  )
})
