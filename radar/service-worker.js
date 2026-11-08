const CACHE_NAME = 'beyblade-x-radar-v0.4.1';
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest',
  './assets/css/styles.css?v=0.4.1', './assets/js/app.js?v=0.4.1',
  './assets/icon.svg', './assets/icon-192.png', './assets/icon-512.png',
  './data/regions.json', './data/stores.json', './data/products.json',
  './data/draw-events.json', './data/draw-sources.json', './data/stores-supplemental.json', './data/source-metadata.json'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isData = /\/data\/.*\.json$/.test(url.pathname);
  const isPage = event.request.mode === 'navigate' || /\/index\.html$/.test(url.pathname) || url.pathname.endsWith('/radar/');
  if (isData || isPage) {
    // Network first for page and JSON so published Google Sheet updates are not hidden by stale cache.
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
    return response;
  })));
});
