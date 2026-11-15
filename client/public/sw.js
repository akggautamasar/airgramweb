self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Pass through all requests (especially /api/stream Range requests) directly to network
self.addEventListener('fetch', () => {});
