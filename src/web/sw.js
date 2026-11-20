// MCdng's service worker: keeps the app on the device so it opens without a connection.
// The app is one page and a few icons. They are served from the cache at once; when there is a connection, the
// page is fetched again in the background and the new version is used from the next opening.
// Requests to Google (sign-in, Drive) are never touched.

const CACHE = 'mcdng-__VERSION__';
const FILES = ['./', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('mcdng-') && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  // Every address of the page (with ?query or after a sign-in) is the one page.
  const key = request.mode === 'navigate' ? './' : request;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(key, { ignoreSearch: request.mode === 'navigate' });
    const fresh = fetch(request).then(response => {
      if (response.ok) cache.put(key, response.clone());
      return response;
    });
    if (cached) {
      event.waitUntil(fresh.catch(() => {}));
      return cached;
    }
    return fresh;
  }));
});
