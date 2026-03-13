// ✨ BUMPED TO VERSION 2 TO FORCE CACHE REFRESH ✨
const CACHE_NAME = 'mangakan-magic-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'favicon.png',
  '/icon-512.png'
];

self.addEventListener('install', event => {
  // Force the new service worker to take over immediately
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // Delete the old broken cache!
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) return caches.delete(cache);
        })
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // RULE 1: NEVER cache API calls (this fixes the 0 devices bug!)
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
      return; 
  }

  // RULE 2: ALWAYS fetch HTML from the internet first, fallback to cache if offline
  if (event.request.headers.get('accept').includes('text/html')) {
      event.respondWith(
          fetch(event.request).catch(() => caches.match(event.request))
      );
      return;
  }

  // RULE 3: Cache images and CSS normally
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});

// ✨ PUSH NOTIFICATION MAGIC ✨
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    
    const title = data.title || "✨ Mangakan Misses You!";
    const options = {
        body: data.body || "Come read some magical new chapters! 🌸",
        icon: '/favicon.png',
        badge: '/favicon.png',
        vibrate: [100, 50, 100],
        data: { url: data.url || '/' }
    };
    
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data.url));
});