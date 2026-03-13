const CACHE_NAME = 'mangakan-magic-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  'favicon.png',
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
// ✨ PUSH NOTIFICATION MAGIC ✨
self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    
    const title = data.title || "✨ Mangakan Misses You!";
    const options = {
        body: data.body || "Come read some magical new chapters! 🌸",
        icon: '/favicon.png', // The cute icon that shows in their notifications
        badge: '/favicon.png',
        vibrate: [100, 50, 100], // Makes the phone vibrate happily!
        data: { url: data.url || '/' }
    };
    
    event.waitUntil(self.registration.showNotification(title, options));
});

// If they click the notification, open the app!
self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data.url));
});