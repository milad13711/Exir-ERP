/* Exir ERP — منطق خالص سرویس‌ورکر (بدون دسترسی به self/caches) تا هم در SW با importScripts و هم در تست (CommonJS) بارگذاری شود. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ExirSwCore = api;
})(typeof self !== "undefined" ? self : this, function () {
  // با هر تغییر رفتار SW عدد را بالا ببرید؛ کش‌های «shell» قدیمی هنگام activate پاک می‌شوند.
  var VERSION = "v5";
  var SHELL_CACHE = "exir-shell-" + VERSION;
  // فایل‌های هش‌دار Next.js بر اساس محتوا نام‌گذاری شده‌اند؛ این کش عمداً بدون نسخه است تا صفحه‌ی بازِ قدیمی بعد از دیپلوی
  // هنوز chunkهای خودش را پیدا کند. سقف تعداد دارد (MAX_IMMUTABLE_ENTRIES).
  var IMMUTABLE_CACHE = "exir-immutable";
  var META_CACHE = "exir-meta";
  var MAX_IMMUTABLE_ENTRIES = 300;
  var OFFLINE_URL = "/offline.html";
  var DEFAULT_ICON = "/icons/icon-192.png";
  var DEFAULT_BADGE = "/icons/badge-96.png";

  var HASHED_ASSET = /\/_next\/static\/(?:chunks|css|media)\/(?:[^/]*[.-])?[0-9a-f]{8,}[^/]*\.(?:js|css|woff2?|png|jpe?g|svg|webp)$/i;

  /**
   * تصمیم‌گیری درباره‌ی هر درخواست:
   *  skip      → SW دخالت نمی‌کند (شبکه‌ی خام): API، داده‌ی Next، غیر GET، cross-origin، Range، خود sw/manifest
   *  immutable → cache-first (فقط فایل‌های هش‌دار /_next/static — در حالت dev نام‌ها هش ندارند ⇒ هرگز کش نمی‌شوند)
   *  static    → stale-while-revalidate (آیکون/برند)
   *  navigate  → شبکه؛ فقط در قطعی کامل صفحه‌ی آفلاین (HTML هرگز کش نمی‌شود ⇒ JS کهنه سرو نمی‌شود)
   */
  function classifyRequest(req, origin) {
    if (!req || req.method !== "GET") return "skip";
    var url;
    try {
      url = new URL(req.url);
    } catch (e) {
      return "skip";
    }
    if (url.origin !== origin) return "skip";
    if (req.hasRange) return "skip";
    var p = url.pathname;
    if (p.indexOf("/api/") === 0 || p === "/api") return "skip"; // پاسخ‌های احراز‌شده هرگز کش نمی‌شوند
    if (p === "/sw.js" || p === "/sw-core.js" || p === "/manifest.webmanifest" || p === "/version") return "skip";
    if (p.indexOf("/_next/data/") === 0 || p.indexOf("/_next/image") === 0) return "skip";
    if (HASHED_ASSET.test(p)) return "immutable";
    if (p.indexOf("/_next/") === 0) return "skip";
    if (p.indexOf("/icons/") === 0 || p.indexOf("/brand/") === 0) return "static";
    if (req.mode === "navigate") return "navigate";
    return "skip";
  }

  function str(v, max) {
    if (typeof v !== "string") return "";
    return v.length > max ? v.slice(0, max) : v;
  }

  /** مسیر درون‌برنامه‌ای امن (فقط «/…»؛ نه «//» یا آدرس خارجی). */
  function safePath(u) {
    if (typeof u !== "string" || u.length > 1024 || u.charAt(0) !== "/" || u.charAt(1) === "/" || u.indexOf("\\") !== -1) return "/dashboard";
    if (/[\u0000-\u001f\u007f]/.test(u)) return "/dashboard";
    try {
      var base = "https://internal.invalid";
      return new URL(u, base).origin === base ? u : "/dashboard";
    } catch (e) {
      return "/dashboard";
    }
  }

  /** payload ورودی (متن JSON، شیء یا هر چیز خراب) → شیء نرمال‌شده با پیش‌فرض‌ها. هرگز throw نمی‌کند. */
  function parsePushPayload(input) {
    var raw = null;
    try {
      if (input && typeof input.json === "function") {
        try {
          raw = input.json();
        } catch (e) {
          raw = { title: "اعلان جدید", body: typeof input.text === "function" ? input.text() : "" };
        }
      } else if (typeof input === "string") {
        try {
          raw = JSON.parse(input);
        } catch (e) {
          raw = { body: input };
        }
      } else if (input && typeof input === "object") {
        raw = input;
      }
    } catch (e) {
      raw = null;
    }
    if (!raw || typeof raw !== "object") raw = {};
    var actions = [];
    if (Array.isArray(raw.actions)) {
      for (var i = 0; i < raw.actions.length && actions.length < 2; i++) {
        var a = raw.actions[i];
        if (a && typeof a.action === "string" && typeof a.title === "string") actions.push({ action: str(a.action, 24), title: str(a.title, 24) });
      }
    }
    var badgeCount = typeof raw.badgeCount === "number" && raw.badgeCount >= 0 && raw.badgeCount < 100000 ? Math.floor(raw.badgeCount) : null;
    return {
      title: str(raw.title, 120) || "اکسیر ERP",
      body: str(raw.body, 300),
      url: safePath(raw.url),
      tag: str(raw.tag, 64) || null,
      icon: typeof raw.icon === "string" && raw.icon.charAt(0) === "/" && raw.icon.charAt(1) !== "/" ? raw.icon : DEFAULT_ICON,
      category: str(raw.category, 24) || null,
      ackToken: str(raw.ackToken, 1024) || null,
      requireInteraction: raw.requireInteraction === true,
      renotify: raw.renotify === true,
      silentIfVisible: raw.silentIfVisible === true,
      entityType: str(raw.entityType, 40) || null,
      entityId: str(raw.entityId, 64) || null,
      actions: actions,
      badgeCount: badgeCount,
    };
  }

  /** گزینه‌های showNotification. renotify فقط با tag معنی دارد (و وگرنه مرورگر خطا می‌دهد). */
  function buildNotificationOptions(p, now) {
    var opts = {
      body: p.body,
      icon: p.icon || DEFAULT_ICON,
      badge: DEFAULT_BADGE,
      dir: "rtl",
      lang: "fa",
      timestamp: typeof now === "number" ? now : Date.now(),
      data: { url: p.url, entityType: p.entityType, entityId: p.entityId, category: p.category },
    };
    if (p.tag) {
      opts.tag = p.tag;
      if (p.renotify) opts.renotify = true;
    }
    if (p.requireInteraction) opts.requireInteraction = true;
    if (p.actions && p.actions.length) opts.actions = p.actions;
    return { title: p.title, options: opts };
  }

  /**
   * آیا باید اعلان سیستمی را نشان نداد (چون برنامه همین حالا باز و فوکوس است)؟
   * فقط Chromium: Safari/WebKit (iOS/macOS) و Firefox برای هر push یک اعلان قابل‌مشاهده می‌خواهند وگرنه اشتراک لغو می‌شود.
   * اعلان‌های requireInteraction (آلارم) همیشه نشان داده می‌شوند.
   */
  function shouldSkipSystemNotification(p, windowClients, userAgent) {
    if (!p.silentIfVisible || p.requireInteraction) return false;
    var ua = userAgent || "";
    if (!/Chrome\//.test(ua) || /Firefox|iPhone|iPad|iPod|CriOS|FxiOS/.test(ua)) return false;
    for (var i = 0; i < windowClients.length; i++) {
      var c = windowClients[i];
      if (c.visibilityState === "visible" && c.focused) return true;
    }
    return false;
  }

  /** پایه‌ی API از پارامتر ?api= مسیر ثبت SW؛ پیش‌فرض /api. فقط http(s) و مسیر نسبی پذیرفته می‌شود. */
  function apiBaseFromSearch(search, origin) {
    var v = "/api";
    try {
      var got = new URLSearchParams(search || "").get("api");
      if (got) v = got;
    } catch (e) {
      /* پیش‌فرض */
    }
    try {
      var u = new URL(v, origin);
      if (u.protocol !== "http:" && u.protocol !== "https:") return origin + "/api";
      return u.href.replace(/\/+$/, "");
    } catch (e) {
      return origin + "/api";
    }
  }

  function buildAckRequest(p, apiBase) {
    if (!p.ackToken) return null;
    return { url: apiBase + "/push/ack", body: JSON.stringify({ t: p.ackToken }) };
  }

  /**
   * کلیک روی اعلان/دکمه‌ی آن → مقصد. اقدام‌های نیازمند احراز هویت («انجام شد»، «۱۰ دقیقه دیگر») از داخل SW اجرا نمی‌شوند
   * (توکن ورود در localStorage است و SW به آن دسترسی ندارد)؛ برنامه با پارامتر act باز می‌شود و خودش اجرا می‌کند.
   */
  function resolveClickTarget(data, action) {
    data = data || {};
    var url = safePath(data.url);
    var conv = /^\/messenger\?(?:.*&)?c=([0-9a-fA-F-]{36})/.exec(url);
    if (conv) {
      var focus = action === "reply";
      if (focus) url += (url.indexOf("?") === -1 ? "?" : "&") + "focus=1";
      return { url: url, message: { type: "messenger-open", conversationId: conv[1], focus: focus } };
    }
    if (data.entityType === "reminder" && data.entityId && (action === "done" || action === "snooze")) {
      var rid = encodeURIComponent(data.entityId);
      return { url: "/dashboard?reminder=" + rid + "&act=" + action, message: { type: "reminder-action", id: data.entityId, act: action } };
    }
    return { url: url, message: { type: "sw-navigate", url: url } };
  }

  /** انتخاب بهترین پنجره‌ی باز: فوکوس‌دار > قابل‌مشاهده > هر پنجره. */
  function pickClient(windowClients) {
    var best = null;
    var score = -1;
    for (var i = 0; i < windowClients.length; i++) {
      var c = windowClients[i];
      var s = (c.focused ? 2 : 0) + (c.visibilityState === "visible" ? 1 : 0);
      if (s > score) {
        best = c;
        score = s;
      }
    }
    return best;
  }

  /** کدام کش‌ها هنگام activate پاک شوند. */
  function cachesToDelete(keys) {
    return keys.filter(function (k) {
      return k !== SHELL_CACHE && k !== IMMUTABLE_CACHE && k !== META_CACHE;
    });
  }

  return {
    VERSION: VERSION,
    SHELL_CACHE: SHELL_CACHE,
    IMMUTABLE_CACHE: IMMUTABLE_CACHE,
    META_CACHE: META_CACHE,
    MAX_IMMUTABLE_ENTRIES: MAX_IMMUTABLE_ENTRIES,
    OFFLINE_URL: OFFLINE_URL,
    DEFAULT_ICON: DEFAULT_ICON,
    DEFAULT_BADGE: DEFAULT_BADGE,
    classifyRequest: classifyRequest,
    parsePushPayload: parsePushPayload,
    buildNotificationOptions: buildNotificationOptions,
    shouldSkipSystemNotification: shouldSkipSystemNotification,
    apiBaseFromSearch: apiBaseFromSearch,
    buildAckRequest: buildAckRequest,
    resolveClickTarget: resolveClickTarget,
    pickClient: pickClient,
    cachesToDelete: cachesToDelete,
    safePath: safePath,
  };
});
