// eventChart Service Worker — offline caching for guest lookup pages
const CACHE = "evcd-v1";
const ESSENTIAL = ["/", "/manifest.webmanifest", "/icon-192.svg", "/icon-512.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ESSENTIAL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isPublicEvent = url.pathname.startsWith("/e/");
  const isPublicApi = url.pathname.startsWith("/api/public/");
  const isLayoutAsset = url.pathname.startsWith("/layouts/") || url.pathname.startsWith("/uploads/");
  const isQrPng = url.pathname.startsWith("/api/qr/");

  if (!isPublicEvent && !isPublicApi && !isLayoutAsset && !isQrPng) return;

  // Cache-first for static layout images and QR PNGs
  if (isLayoutAsset || isQrPng) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return cached ?? Response.error();
        }
      })
    );
    return;
  }

  // Network-first with cache fallback for /e/ pages and /api/public/ data
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Offline fallback for lookup page
        if (isPublicEvent) {
          const fallback = await caches.match("/");
          if (fallback) return fallback;
        }
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});
