# اعلان به‌روزرسانی ماژول‌ها به تننت‌ها

وقتی ادمین پلتفرم یک انتشار (نسخه‌ی ماژول) را منتشر می‌کند، هر تننتِ ACTIVE که **همان ماژول** را فعال دارد (همان منطق `ModuleGuard` / `isModuleEnabled`، با وابستگی‌های انتقالی) خبردار می‌شود:

| کانال | چه می‌شود | گیرندگان |
|---|---|---|
| `notify` | اعلان درون‌برنامه + پوش (طبق ترجیح‌های هر کاربر، دسته‌ی `system`) | همه‌ی کاربران ACTIVE تننت |
| `ticket` | یک تیکت خودکار (`category=MODULE_RELEASE`، فرستنده `SYSTEM`، وضعیت RESOLVED تا صف پشتیبانی شلوغ نشود) به نام مالک تننت | مالک (یا ADMIN) |
| `sms` | یک پیامک کوتاه: نام ماژول + نسخه + لینک `…/releases/<shortCode>` (هیچ متن آزادی داخل پیامک نمی‌رود) | حداکثر ۳ مالک/مدیر |

کانال‌ها هنگام انتشار توسط ادمین انتخاب می‌شوند (ذخیره در `ModuleRelease.channels`).

## داده
- **control DB** (`prisma/control`): `ModuleRelease` (+`shortCode`, وضعیت TEXT: DRAFT/PUBLISHED, یکتا روی `moduleCode+version`)، `ModuleReleaseChange` (نوع NEW/IMPROVED/FIX، عنوان، توضیح، `valueText` = «ارزش جدید برای شما»، `deepLink` اختیاری)، `ModuleReleaseDelivery` (یکتا روی `releaseId+tenantId+channel`؛ کانال‌های NOTIFY/TICKET/SMS و TEST)، و دو ستون افزودنی روی `support_tickets`: `category`, `sourceRef` (یکتا با `tenantId`).
- **tenant DB**: `ModuleReleaseRead` (دیده‌شدن هر کاربر). خودِ انتشار در control می‌ماند. ثبت در ownership-registry (PERSONAL).
- مایگریشن‌ها: `20261031100000_module_releases` (control) و `20261031100000_module_release_reads` (tenant) — فقط افزایشی.

## عدم تکرار (idempotency)
۱) ردیف یکتای تحویل (انتشار، تننت، کانال) پیش از ارسال با `create` برداشته می‌شود (برنده‌ی رقابت یکی است). ۲) داخل تننت: اعلان با `entityType=module-release, entityId`؛ تیکت با `sourceRef` یکتا؛ پیامک با claim در `ModuleSetting` (`rel:sms:<release>:<user>`). تلاش مجدد فقط ردیف‌های FAILED/PARTIAL/PENDING متروک (>۱۰ دقیقه) و SKIPPEDهای قابل‌تکرار (`DAILY_CAP`, `NO_SMS_CHANNEL`, `NO_PUBLIC_URL`) را برمی‌دارد؛ SENT و انصراف/بدون‌گیرنده هرگز.

## ایمنی هزینه‌ی پیامک
- **پیامک برای تننت‌ها opt-in است (پیش‌فرض خاموش):** اعلان درون‌برنامه و تیکت پیش‌فرض روشن‌اند ولی `sms` فقط وقتی مالک/مدیر صراحتاً روشن کند ارسال می‌شود (`normalizePrefs`: `sms === true`)، چون از اعتبار پیامک خود تننت کسر می‌شود. کانال پیامک هنگام انتشار هم باید توسط تیم محصول انتخاب شود.
- ویرایش یک انتشار (عنوان/خلاصه/تغییرات) فقط در وضعیت پیش‌نویس مجاز است؛ پس از انتشار ۴۰۹.
- تننت بدون پنل پیامک (`mode=NONE`) رد می‌شود؛ `WEB_PANEL_PUBLIC_URL` تنظیم‌نشده ⇒ پیامک نمی‌رود.
- انصراف تننت: مالک/مدیر در صفحه‌ی «تازه‌های سیستم» هر کانال را خاموش می‌کند (`ModuleSetting platform/release-announcements`).
- سقف روزانه: حداکثر ۶ پیامک «اعلان انتشار» در هر روز تهران برای هر تننت (همه‌ی انتشارها)، حداکثر ۳ گیرنده برای هر انتشار.
- پیامک شکست‌خورده claimها را آزاد می‌کند تا «ارسال دوباره» بتواند تکرارش کند. هزینه از پنل پیامک خود تننت (بسته/پنل اختصاصی) کسر می‌شود.

## API
ادمین (`AdminJwtAuthGuard` + `AdminTeamsGuard`؛ نوشتن: SUPER_ADMIN/ENGINEERING، خواندن: + SUPPORT):
`GET /admin/module-releases[?status=]`, `GET …/meta`, `GET …/:id`, `POST …`, `PATCH …/:id`, `DELETE …/:id` (فقط پیش‌نویس), `GET …/:id/recipients` (پیش‌نمایش تعداد), `POST …/:id/publish {channels, confirm:true}`, `POST …/:id/retry`, `POST …/:id/test-send {tenantId, channels}`, `GET …/:id/report`.

تننت (`JwtAuthGuard`، فقط ماژول‌های فعال خودش):
`GET /module-releases`, `GET …/unread-count`, `GET …/:idOrShortCode`, `POST …/:id/read`, `POST …/read-all`, `GET|PUT …/settings` (OWNER/ADMIN).

## امنیت
متن‌ها plain-text می‌شوند (حذف HTML/کنترل/bidi). `deepLink` فقط مسیر نسبی با ریشه‌ی مجاز (`ALLOWED_ROUTE_ROOTS` در `module-release.logic.ts`، همسو با `nav.ts`) و بدون `//`، `..`، اسکیم؛ سمت کلاینت هم دوباره سنجیده می‌شود. انتشار نامربوط به ماژول تننت ⇒ ۴۰۴ (بدون نشت وجود).

## افزودن ماژول/مسیر جدید
مسیر پیش‌فرض ماژول را در `MODULE_ROUTES` (`src/module-releases/module-release.logic.ts`) اضافه کنید تا دکمه‌ی «رفتن به ماژول و تست» کار کند.

## محدودیت‌ها
- پخش در پس‌زمینه‌ی همان پروسه اجرا می‌شود؛ ری‌استارت وسط کار ⇒ از پنل «ارسال دوباره» بزنید (امن است).
- لینک عمومی بدون ورود (public token) عمداً ساخته نشده؛ لینک پیامک نیازمند ورود به پنل است.
