const CACHE_NAME = 'field-planner-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for same-origin GETs, falling back to cache when offline.
// Cross-origin requests (Supabase sync calls) are left untouched.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req))
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Field Planner', body: 'Update available.' };
  try { if (event.data) payload = event.data.json(); } catch (e) { /* keep default */ }
  const title = payload.title || 'Field Planner';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'field-planner',
    data: { url: payload.url || '/' },
    actions: payload.actions || []
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Day-type actions on the daily-log notification (Office/WFH/Home) always
// mean "log today" — there's no other day context to carry from that
// notification, so the action id doubles as the dayType to set.
const QUICK_LOG_DAYTYPES = ['office', 'wfh', 'home', 'travel', 'leave'];

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action;
  const url = (event.notification.data && event.notification.data.url) || '/';

  if (QUICK_LOG_DAYTYPES.includes(action)) {
    event.waitUntil((async () => {
      const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clientList.find((c) => c.url.startsWith(self.location.origin));
      if (client) {
        client.postMessage({ type: 'QUICK_LOG_TODAY', dayType: action });
        if ('focus' in client) client.focus();
      } else if (clients.openWindow) {
        await clients.openWindow(`/?quicklog=${encodeURIComponent(action)}`);
      }
    })());
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
