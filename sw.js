/* Cache only the app shell, never a third-party price response. */
const CACHE_PREFIX = 'arezzo-gold-shell-' + encodeURIComponent(self.registration.scope) + '-';
const CACHE = CACHE_PREFIX + '1.1.1';
const FILES = ['./', './index.html', './styles.css', './pricing.js', './feeds.js', './app.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/icon-maskable.png'];
self.addEventListener('install', event => {
  // A new worker waits for old app tabs to close, avoiding mixed-version pricing code.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (e) {
      if (event.request.mode === 'navigate') return cache.match('./index.html');
      return new Response('Offline', { status: 503 });
    }
  }));
});
