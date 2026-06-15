// Minimal offline-shell service worker.
// Caches the app shell so it opens instantly; data + AI calls still need network.
const CACHE = "intake-shell-v1";
const SHELL = ["/", "/login", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never cache API calls or non-GET — always go to network.
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) {
    return;
  }
  // Network-first for navigations, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((r) => r || Response.error()))
    );
    return;
  }
  // Cache-first for static assets.
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request))
  );
});
