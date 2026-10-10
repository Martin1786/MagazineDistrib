const CACHE_NAME = 'magazine-distribution-v13'; // bump this on every release
const APP_FILES = ['./', './index.html', './styles.css', './app.js', './config.js', './assets/areas.geojson', './manifest.webmanifest', './assets/icon.svg', './assets/magazine-distribution-seed.json'];

self.addEventListener('install', (event) => {
  // add files one by one so a single missing file doesn't block installation
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(APP_FILES.map((f) => cache.add(f).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Stale-while-revalidate: instant from cache, refreshed in the background for next time
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const host = new URL(req.url);
  if (req.method !== 'GET' || (host.origin !== self.location.origin && host.hostname !== 'cdnjs.cloudflare.com')) return;
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
    return cached || network;
  }));
});
