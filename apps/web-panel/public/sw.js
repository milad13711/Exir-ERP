// Exir ERP service worker — makes the app installable and keeps it usable
// when the connection drops (common on Iranian mobile/international links):
// - App shell + static assets: cache-first (they're content-hashed by Next.js,
//   so a cached copy is always valid for its URL).
// - Page navigations: network-first, falling back to the last cached copy of
//   that page, then to /offline.html if nothing was ever cached for it.
// - API GET requests: network-first, cached as a read-through fallback so
//   switching screens while offline still shows last-known data.
// Mutating API calls (POST/PUT/DELETE) are NOT handled here — those go
// through the offline write queue in src/lib/offline (IndexedDB-backed),
// since a queued write needs app-level retry/merge logic a cache can't do.

const SHELL_CACHE = "exir-shell-v1";
const API_CACHE = "exir-api-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll([OFFLINE_URL])).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== API_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isApiRequest(url) {
  return url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // mutations are the offline queue's job, not the SW's
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (isApiRequest(url)) {
    event.respondWith(
      caches.open(API_CACHE).then(async (cache) => {
        try {
          const res = await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          const cached = await cache.match(req);
          if (cached) return cached;
          return new Response(JSON.stringify({ offline: true, message: "داده‌ای برای نمایش آفلاین موجود نیست" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
      }),
    );
    return;
  }

  // Page navigation
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (await cache.match(req)) ?? (await cache.match(OFFLINE_URL));
        }),
    );
  }
});
