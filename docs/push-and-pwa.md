# PWA و پوش نوتیفیکیشن (Web Push)

## معماری
- **Manifest**: `apps/web-panel/public/manifest.webmanifest` (id، scope، rtl/fa، آیکون‌های any/maskable، shortcuts: کارتابل/پیام‌رسان/وظایف/یادآوری‌ها).
- **سرویس‌ورکر**: `public/sw.js` (اتصال به APIهای مرورگر) + `public/sw-core.js` (منطق خالص، با vitest تست می‌شود). ثبت با `/sw.js?api=<API_URL>` تا SW بتواند ack را بزند.
  - HTML، `/api/*` و `/_next/data` هرگز کش نمی‌شوند؛ فقط فایل‌های هش‌دار `/_next/static` (کش بدون نسخه `exir-immutable`) و آیکون‌ها. قطعی کامل ⇒ `/offline.html`.
  - در `next dev` ثبت نمی‌شود و SW/کش قدیمی پاک می‌شود (برای تست پوش لوکال: `localStorage.setItem("exir-sw-dev","1")`).
  - هدرها در `next.config.ts`: `sw.js`/`sw-core.js` no-cache، manifest must-revalidate. پشت CDN باید `/sw.js`، `/sw-core.js` و `/api/*` کش نشوند.
  - نسخه‌ی جدید SW یا شکست بارگذاری chunk ⇒ نوار «نسخه‌ی جدید» با دکمه‌ی بارگذاری مجدد.
- **سرور**: `src/notifications/`
  - `push-logic.ts` (خالص): دسته‌بندی، ماتریس تصمیم کانال×ترجیح×ساعات سکوت، TTL/urgency، payload ≤ ~۳٫۸KB، توکن‌های HMAC، طبقه‌بندی خطا، سقف پیامک جایگزین.
  - `push-notifications.service.ts`: ارسال چنددستگاهی، timeout ۱۰ثانیه، concurrency ۸، حذف فوری ۴۰۴/۴۱۰، حذف پس از ۸ شکست پیاپی غیرگذرا، رد دستگاه‌های با کلید VAPID قدیمی، ثبت `PushAttempt`.
  - `notifications.service.ts` (`notify()` هرگز پرتاب نمی‌کند): ترجیح هر دسته، ساعات سکوت (تهران؛ حیاتی‌ها مستثنا)، محرمانه ⇒ متن عمومی، پیامک جایگزین (پیش‌فرض خاموش؛ سقف ۳ در روز، cooldown ۱۰ دقیقه).
  - `notification-delivery.service.ts` (`@Global`): `markDelivered(tenantDb, userId, ids, via, tenantId?)` و `registerHandler(...)`.
  - `push-ack.controller.ts`: `POST /api/push/ack {t}` و `POST /api/push/rotate` عمومی، ۲۰۴ همیشگی، rate-limit به‌ازای IP.

## قرارداد تحویل (ack)
هر push حاوی `ackToken` = HMAC(notificationId, userId, نام DB تننت, انقضای ۷ روز) است؛ کلید از `APP_SECRETS_KEY` با جداسازی دامنه (`exir:push-ack:v1`) مشتق می‌شود (بدون آن از `VAPID_PRIVATE_KEY`). SW هنگام دریافت push (حتی با برنامه‌ی بسته) آن را با `fetch keepalive` می‌فرستد ⇒ `Notification.deliveredAt/deliveredVia='push'` و فراخوانی هندلرها. مسیر درون‌برنامه: زنگوله اعلان‌های تحویل‌نشده را دسته‌ای به `POST /notifications/delivered` می‌دهد.

## متغیرهای محیطی
`VAPID_PUBLIC_KEY`، `VAPID_PRIVATE_KEY`، `VAPID_SUBJECT` (اختیاری، `mailto:` یا `https:`؛ پیش‌فرض `mailto:support@exir.co`)، `APP_SECRETS_KEY`. در docker-compose آن‌ها باید به کانتینر backend پاس داده شوند. **چرخش کلید VAPID**: همه‌ی اشتراک‌ها نامعتبر می‌شوند؛ سرور آن‌ها را رد می‌کند (`vapid_mismatch`) و کلاینت در همگام‌سازی بعدی خودکار دوباره اشتراک می‌گیرد.

## ماتریس دستگاه‌ها
| دستگاه | نصب | پوش | نکات/محدودیت |
|---|---|---|---|
| Android Chrome/Edge | `beforeinstallprompt` (بنر «نصب اپ») | بله، حتی با برنامه‌ی بسته | صرفه‌جویی باتری (Samsung/Xiaomi/Huawei) ممکن است تأخیر بدهد |
| Samsung Internet | از منو «افزودن به صفحه اصلی» | بله | مسدودی در تنظیمات سایت‌ها |
| iOS/iPadOS Safari ≥ 16.4 | فقط دستی (Share ← Add to Home Screen) | **فقط برنامه‌ی نصب‌شده** | هر push باید اعلان نشان دهد (silentIfVisible غیرفعال است)؛ Chrome/Firefox iOS نصب ندارند |
| دسکتاپ Chrome/Edge | آیکون نصب در آدرس‌بار | بله | با بسته‌بودن مرورگر وابسته به سیستم‌عامل |
| Firefox دسکتاپ | نصب PWA ندارد | بله | Firefox اندروید: پوش بله، نصب محدود |
| Safari macOS | «Add to Dock» | بله (۱۶+) | |
| مرورگر درون‌برنامه‌ای (اینستاگرام، تلگرام، WebView) | خیر | خیر | کاربر را به «باز کردن در مرورگر» هدایت می‌کنیم |
| HTTP (بدون TLS) | خیر | خیر | secure context لازم است؛ سرور تولید فعلی روی IP بدون HTTPS است ⇒ **پوش/نصب تا HTTPS نشود کار نمی‌کند** |

## عیب‌یابی
صفحه‌ی `تنظیمات ← اعلان‌ها ← عیب‌یابی` (`/settings/notifications/diagnostics`): بررسی secure/permission/SW/PushManager/اشتراک/کلید، ۲۰ تلاش اخیر با کد HTTP و دلیل، «اصلاح خودکار» و «ارسال آزمایشی» (sent ← delivered).
کدها: ۴۰۴/۴۱۰ منقضی (حذف)، ۴۰۱/۴۰۳ کلید/VAPID، ۴۱۳ بزرگ‌بودن، ۴۲۹ محدودیت نرخ، ۵xx موقت، timeout شبکه.

## مهاجرت
`prisma/tenant/migrations/20261024110000_push_delivery` — افزایشی: ستون‌های `notifications` (entityType/entityId/category/deliveredAt/deliveredVia)، `notification_preferences` (categoryPrefs/quiet*/smsFallbackEnabled)، `push_subscriptions` (label/userAgent/lastSeenAt/lastSuccessAt/lastFailureAt/failureCount/vapidKeyHash)، جدول `push_attempts`.

## چک‌لیست تست دستی (دستگاه واقعی)
1. اندروید Chrome: ورود ← بنر «نصب اپ» ← نصب ← «فعال‌سازی اعلان» ← تنظیمات اعلان ← «آزمایشی به این دستگاه»: اعلان + «رسید دستگاه ✓».
2. آیفون: Safari ← Share ← Add to Home Screen ← باز کردن از آیکون ← فعال‌سازی ← آزمایشی.
3. برنامه را کامل ببندید؛ از حساب دیگر پیام پیام‌رسان بفرستید ⇒ اعلان؛ کلیک ⇒ همان گفتگو.
4. یادآوری ۲ دقیقه بعد با کانال پوش بسازید، برنامه بسته: اعلان ماندگار با دکمه‌های «انجام شد/۱۰ دقیقه دیگر»؛ دکمه ⇒ برنامه باز و اقدام اجرا.
5. وظیفه ارجاع دهید ⇒ اعلان + تیک «دریافت‌شد» برای ارجاع‌گیرنده.
6. خروج از حساب ⇒ دستگاه از فهرست دستگاه‌ها حذف شود؛ ورود دوباره ⇒ خودکار برگردد.
7. مجوز را در تنظیمات مرورگر Block کنید ⇒ راهنمای رفع نمایش داده شود.
8. ساعات سکوت را روی الان بگذارید ⇒ پیام عادی بی‌پوش، آلارم یادآوری با پوش.
