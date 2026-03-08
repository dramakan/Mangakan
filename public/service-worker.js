const CACHE_NAME = 'mangakan-magic-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// Install the Service Worker and save core files to the phone's memory
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✨ Magic Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

// Serve cached files to make the app load lightning fast
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return the cached version if found, otherwise grab it from the internet
        return response || fetch(event.request);
      })
  );
});