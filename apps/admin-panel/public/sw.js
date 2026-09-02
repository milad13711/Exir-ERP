// Admin panel service worker — exists mainly for installability (PWA) and
// web push notifications (new support-ticket messages), not offline
// support like the tenant web-panel's sw.js (this is an internal tool,
// always used online). No fetch handler on purpose: nothing here should
// ever serve a stale cached response for an admin screen.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "پیام جدید", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "پنل مدیریت اکسیر", {
      body: payload.body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url || "/support" },
      dir: "rtl",
      lang: "fa",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/support";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
