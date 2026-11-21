// A deliberately empty, no-cache service worker.
//
// ARK holds confidential client data and must always load fresh from
// the server — this file exists only because Chrome/Android's PWA
// installability check requires *some* service worker with a fetch
// handler registered before it will offer the "Install app" prompt.
// It never calls event.respondWith() in the fetch handler, which means
// every request is left completely untouched and goes straight to the
// network exactly as if this file didn't exist — no caching of pages,
// API responses, or anything else, ever.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally a no-op passthrough — see the file comment above.
});
