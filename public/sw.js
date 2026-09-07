/* Minimal service worker hook for Detergents Delivered PWA.
   Caching and offline catalog come in a later phase. */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Network-first passthrough. Intentionally no cache strategy yet.
});
