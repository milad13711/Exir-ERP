/* eslint-disable no-restricted-globals */
// منطق Background Sync برای «کار آفلاین و همگام‌سازی» (ماژول offline-sync) — با importScripts('/sw-sync.js') در sw.js بارگذاری می‌شود.
// سرویس‌ورکر به توکن دسترسی ندارد (localStorage ندارد) و صف هم رمزنگاری‌شده است؛ پس خودش درخواستی نمی‌فرستد.
// وظیفه‌اش فقط بیدار کردن صفحه‌ی باز است تا موتور همگام‌سازی صفحه اجرا شود. روی iOS/Safari/Firefox رویداد sync وجود ندارد؛
// آنجا همگام‌سازی هنگام رویداد online / بازگشت به برنامه / تایمر ۶۰ ثانیه‌ای صفحه انجام می‌شود.
self.addEventListener("sync", (event) => {
  if (event.tag !== "exir-outbox-sync") return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const c of clients) c.postMessage({ type: "exir-sync-request" });
      // اگر پنجره‌ای نیست، رویداد sync دوباره تلاش می‌شود (مرورگر خودش retry می‌کند)؛ بدون پنجره ارسال ممکن نیست
      if (clients.length === 0) throw new Error("no-client");
    }),
  );
});
