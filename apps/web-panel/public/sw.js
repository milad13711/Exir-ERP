// Exir ERP service worker. منطق خالص در /sw-core.js (قابل‌آزمون)؛ اینجا فقط اتصال به APIهای مرورگر.
//
// اصول:
//  - HTML و /api و داده‌ی Next هرگز کش نمی‌شوند ⇒ JS/داده‌ی کهنه سرو نمی‌شود، پاسخ احراز‌شده روی دستگاه مشترک نمی‌ماند.
//  - فقط فایل‌های هش‌دار /_next/static با cache-first؛ آیکون‌ها stale-while-revalidate؛ قطعی کامل ⇒ /offline.html.
//  - push: payload امن پارس می‌شود، ack تحویل (fetch keepalive) حتی با برنامه‌ی بسته ثبت می‌شود.
//  - pushsubscriptionchange: اشتراک جدید با «توکن دستگاه» (بدون نیاز به ورود) روی سرور جایگزین می‌شود.
importScripts("/sw-core.js?v=5");
// ── نقطه‌ی الحاق برای ماژول‌های دیگر: یک خط importScripts("/sw-sync.js?v=…") درست همین‌جا اضافه شود (پس از sw-core، پیش از هندلرها). ──

const Core = self.ExirSwCore;
const API_BASE = Core.apiBaseFromSearch(self.location.search, self.location.origin);

self.addEventListener("install", (event) => {
  // SW هیچ وابستگی‌ای به نسخه‌ی صفحه ندارد؛ فعال‌سازی فوری امن است (chunkهای هش‌دار در کش بدون‌نسخه می‌مانند).
  event.waitUntil(caches.open(Core.SHELL_CACHE).then((c) => c.addAll([Core.OFFLINE_URL])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(Core.cachesToDelete(keys).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) await self.registration.navigationPreload.disable().catch(() => {});
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const d = event.data;
  if (d && d.type === "SKIP_WAITING") self.skipWaiting();
});

// ── fetch ───────────────────────────────────────────────────────────────────
async function trimImmutable(cache) {
  const keys = await cache.keys();
  const extra = keys.length - Core.MAX_IMMUTABLE_ENTRIES;
  for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const kind = Core.classifyRequest({ method: req.method, url: req.url, mode: req.mode, hasRange: req.headers.has("range") }, self.location.origin);
  if (kind === "skip") return;

  if (kind === "immutable") {
    event.respondWith(
      caches.open(Core.IMMUTABLE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === "basic") {
          cache.put(req, res.clone()).then(() => trimImmutable(cache)).catch(() => {});
        }
        return res;
      }),
    );
    return;
  }

  if (kind === "static") {
    event.respondWith(
      caches.open(Core.SHELL_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      }),
    );
    return;
  }

  // navigate: شبکه؛ فقط اگر واقعاً قطع بود صفحه‌ی آفلاین
  event.respondWith(
    fetch(req).catch(async () => {
      const cache = await caches.open(Core.SHELL_CACHE);
      return (await cache.match(Core.OFFLINE_URL)) || new Response("offline", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }),
  );
});

// ── push ────────────────────────────────────────────────────────────────────
function ackDelivery(payload) {
  const ack = Core.buildAckRequest(payload, API_BASE);
  if (!ack) return Promise.resolve();
  return fetch(ack.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: ack.body,
    keepalive: true,
    credentials: "omit",
  }).catch(() => {});
}

async function applyBadge(payload) {
  try {
    if (payload.badgeCount !== null && self.navigator && "setAppBadge" in self.navigator) {
      await (payload.badgeCount > 0 ? self.navigator.setAppBadge(payload.badgeCount) : self.navigator.clearAppBadge());
    }
  } catch (e) {
    // Badging API همه‌جا نیست — مهم نیست
  }
}

async function handlePush(event) {
  const payload = Core.parsePushPayload(event.data);
  const ackP = ackDelivery(payload);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true }).catch(() => []);
  // برنامه الان باز است: به صفحه خبر بده تا فوراً تازه شود (زنگوله/صدا)
  for (const c of windows) c.postMessage({ type: "push-received", category: payload.category, entityType: payload.entityType, entityId: payload.entityId });

  if (Core.shouldSkipSystemNotification(payload, windows, self.navigator.userAgent)) {
    await ackP;
    return;
  }
  const { title, options } = Core.buildNotificationOptions(payload, Date.now());
  try {
    await self.registration.showNotification(title, options);
  } catch (e) {
    // برخی مرورگرها با actions/badge نامعتبر خطا می‌دهند: ساده‌شده دوباره تلاش کن تا اعلان هرگز گم نشود
    await self.registration.showNotification(title, { body: options.body, icon: options.icon, dir: "rtl", lang: "fa", data: options.data, tag: options.tag });
  }
  await Promise.all([ackP, applyBadge(payload)]);
}

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

// ── click ───────────────────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = Core.resolveClickTarget(event.notification.data, event.action);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = Core.pickClient(windows);
      if (client && "focus" in client) {
        try {
          await client.focus();
          client.postMessage(target.message);
          return;
        } catch (e) {
          // focus ممکن است رد شود (مثلاً پنجره‌ی در حال بسته‌شدن) ⇒ پنجره‌ی جدید
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(target.url);
    })(),
  );
});

// ── pushsubscriptionchange ──────────────────────────────────────────────────
async function readMeta() {
  try {
    const cache = await caches.open(Core.META_CACHE);
    const res = await cache.match("/__exir_push_meta");
    return res ? await res.json() : {};
  } catch (e) {
    return {};
  }
}

async function writeMeta(meta) {
  try {
    const cache = await caches.open(Core.META_CACHE);
    await cache.put("/__exir_push_meta", new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
  } catch (e) {
    /* بدون Cache API فقط ذخیره‌ی توکن بعدی ممکن نیست */
  }
}

function b64urlToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const meta = await readMeta();
      let sub = event.newSubscription || null;
      if (!sub) {
        const key = meta.publicKey ? b64urlToBytes(meta.publicKey) : event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
        if (!key) return;
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      const json = sub.toJSON();
      if (meta.rotateToken && json.keys) {
        // توکن چرخش یک‌بارمصرف است: پاسخ موفق (۲۰۰) توکن بعدی را می‌دهد و باید جایگزین شود؛ ۲۰۴ یعنی رد شد (نشست/دستگاه نامعتبر)
        const res = await fetch(API_BASE + "/push/rotate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ t: meta.rotateToken, endpoint: sub.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }),
          keepalive: true,
          credentials: "omit",
        }).catch(() => null);
        if (res && res.status === 200) {
          const next = await res.json().catch(() => null);
          if (next && typeof next.t === "string") await writeMeta({ ...meta, rotateToken: next.t });
        }
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of windows) c.postMessage({ type: "push-resubscribed" });
    })(),
  );
});

// کار آفلاین و همگام‌سازی (ماژول offline-sync): رویداد Background Sync — منطق در sw-sync.js
importScripts("/sw-sync.js");
