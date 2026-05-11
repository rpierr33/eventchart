// eventChart Service Worker — offline caching + Web Push for walk-in alerts
const CACHE = "evcd-v2";
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
        if (isPublicEvent) {
          const fallback = await caches.match("/");
          if (fallback) return fallback;
        }
        return new Response("Offline", { status: 503 });
      }
    })()
  );
});

// Web Push handler — wakes the host phone when a walk-in needs approval.
// Server sends JSON: { title, body, url, tag }
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "eventChart", body: event.data.text() };
  }
  const { title = "eventChart", body = "", url = "/", tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: "/icon-192.svg",
      badge: "/icon-192.svg",
      data: { url },
      requireInteraction: true, // stays on screen until host taps — walk-in approvals can't be missed
      vibrate: [120, 60, 120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab on the same path if possible
      for (const c of clientList) {
        const u = new URL(c.url);
        if (u.pathname === target) {
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
