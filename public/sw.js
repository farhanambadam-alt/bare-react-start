const CACHE_NAME = 'img-cache-v1';
const MAX_ENTRIES = 200;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // Only cache image requests (external & local)
  const isImage =
    e.request.destination === 'image' ||
    /\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(url) ||
    url.includes('images.unsplash.com') ||
    url.includes('img.youtube.com');

  if (!isImage || e.request.method !== 'GET') return;

  e.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(e.request);
      if (cached) return cached;

      try {
        const response = await fetch(e.request);
        if (response.ok) {
          // Clone and cache
          cache.put(e.request, response.clone());
          // Evict old entries if too many
          cache.keys().then((keys) => {
            if (keys.length > MAX_ENTRIES) {
              keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => cache.delete(k));
            }
          });
        }
        return response;
      } catch {
        // Offline and not cached — return placeholder
        const placeholder = await cache.match('/placeholder.svg');
        if (placeholder) return placeholder;
        return new Response('', { status: 503 });
      }
    })
  );
});
