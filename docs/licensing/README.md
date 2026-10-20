# سیستم لایسنس اکسیر — معماری، API و راهنمای عملیات

این سند سیستم لایسنس نرم‌افزار و ماژول‌ها را برای سه حالت توضیح می‌دهد: **ابری (SaaS)**، **سرور اختصاصی ما**، **سرور اختصاصی مشتری (on-premise)**.
مدل تهدید و محدودیت‌های واقعی: [`threat-model.md`](threat-model.md). راهنمای مشتری: [`customer-guide-fa.md`](customer-guide-fa.md). متن قرارداد: [`license-terms-fa.md`](license-terms-fa.md).

> **مهم — استقرار ابری ما = `DEPLOYMENT_MODE=CLOUD`.** سرور تولید چندتننتی خودمان باید `CLOUD` باشد. `ON_PREMISE` یعنی «نصب تک‌مشتری با لایسنس»: در آن `ModuleGuard` هر ماژول غیرهسته‌ای را که در توکن امضاشده نیست رد می‌کند و سقف کاربر اعمال می‌شود. اگر یک استقرار چندتننتی اشتباهاً `ON_PREMISE` باشد، ماژول‌های خارج از توکن برای همه‌ی تننت‌ها قفل می‌شوند؛ برای کمک، backend در بوت اگر `ON_PREMISE` و بیش از یک تننت فعال ببیند خطای بلند لاگ می‌کند. پیش‌فرض `docker-compose.on-premise.yml` همچنان `ON_PREMISE` است و با `DEPLOYMENT_MODE` در `.env` قابل override است.

## ۱. چه چیزی وجود داشت و چه چیزی اضافه شد

| قبلاً بود | اکنون |
|---|---|
| توکن آفلاین Ed25519 (`license-token.ts`)، مدل `License` (کلید = خود توکن)، check-in ساده، `LicenseGuard`، `LicenseBlockedScreen` | **کلید یکتای `LIC-XXXXX-XXXXX-XXXXX-XXXXX`** (CSPRNG، غیرقابل‌ویرایش)، وضعیت `ACTIVE/SUSPENDED/REVOKED` + وضعیت مؤثر محاسبه‌ای (`expired`)، حذف نرم |
| انقضای اجباری | **لایسنس دائمی** (`expiresAt = null`) + `updatesUntil` (حق به‌روزرسانی/پشتیبانی) |
| بدون فعال‌سازی | **Activation** مقید به `installationId` + اثرانگشت میزبان، سقف `maxActivations` (۰ = نامحدود) با **قفل ردیف** در تراکنش |
| بدون کنترل کاربر/ماژول سمت سرور در on-prem | `ModuleGuard` + سقف کاربر از **توکن امضاشده** اعمال می‌شود |
| — | API عمومی `verify/activate/deactivate/checkin`، CRL امضاشده، چرخش کلید با `kid`، ردپای فقط‌افزودنی، محدودیت نرخ/قفل نمایی، مانیفست یکپارچگی کد، پنل «مدیریت لایسنس» |

فایل‌ها (`apps/backend-core/src/licensing/`): `license-crypto.ts` (Ed25519، kid، ارزیابی توکن) · `license-key.ts` (تولید کلید، نرمال‌سازی، وضعیت مؤثر) · `license-public.service.ts` + `license-api.controller.ts` (API عمومی) · `license-admin.service.ts` + `admin/admin-licenses.controller.ts` · `license-runtime.service.ts` (سمت محصول) · `license-state.ts`, `host-fingerprint.ts` · `integrity-manifest.ts`, `integrity.service.ts` · `license-throttle.ts`, `license-audit.service.ts`, `license-settings.service.ts`, `license-signing.service.ts`.
مدل داده (`prisma/control`): `License`, `LicenseActivation`, `LicenseEvent` (ردپا)، `LicenseSetting`. مایگریشن: `20261019100000_license_system` (افزایشی؛ لایسنس‌های قدیمی در اولین بوت کلید `LIC-…` می‌گیرند و توکن v1 آن‌ها کار می‌کند).

## ۲. معماری

```
سرور لایسنس (کنترل‌پلین ما)                       نصب مشتری / تننت اختصاصی
 ┌────────────────────────────┐   activate/checkin   ┌──────────────────────────────┐
 │ License, LicenseActivation │ ◄─────────────────── │ LicenseRuntimeService         │
 │ کلید خصوصی Ed25519 (env/    │ ───────────────────► │  • کلید عمومی (keyring by kid) │
 │ فایل راز، رمزگذاری‌شده)      │  پاسخ امضاشده +      │  • state: installationId،      │
 │ CRL، ردپا، تنظیمات          │  توکن فعال‌سازی      │    توکن، lastSeen، CRL         │
 └────────────────────────────┘                      │ LicenseGuard / ModuleGuard /   │
                                                      │ سقف کاربر / توقف cron          │
                                                      │ IntegrityService (manifest)    │
                                                      └──────────────────────────────┘
```

- **ابری:** `DEPLOYMENT_MODE` غیر `ON_PREMISE` → `LicenseRuntimeService` بی‌اثر؛ مجوز ماژول همان `TenantModule` + `ModuleGuard` است (خرید/اشتراک). لایسنس دائمی ابری را با ایجاد لایسنس و اتصال `tenantId` ثبت کنید (برای گزارش/مدیریت).
- **سرور اختصاصی ما:** مثل ابری (یک نصب مستقل بدون `ON_PREMISE`)، یا اگر خواستید همان فرآیند مشتری را اجرا کنید با `ON_PREMISE`.
- **سرور مشتری:** `DEPLOYMENT_MODE=ON_PREMISE`، فقط ایمیج Docker (بدون سورس)، `LICENSE_KEY=LIC-…` + `LICENSE_SERVER_URL` یا توکن آفلاین.

### جریان‌ها
1. **صدور:** ادمین (SUPER_ADMIN) در پنل «مدیریت لایسنس» → کلید `LIC-…` می‌سازد (یا CLI `npm run license:issue`).
2. **فعال‌سازی:** نصب در اولین بوت `installationId` تصادفی می‌سازد (در volume)، اثرانگشت میزبان (۵ هش) را حساب و `POST /api/license-api/activate` می‌زند. سرور (در تراکنش با قفل ردیف) ظرفیت را می‌سنجد و **توکن فعال‌سازی** Ed25519 برمی‌گرداند: `licenseKey, installationId, fp, product, edition, modules, maxUsers, issuedAt, notBefore, expiresAt|null, updatesUntil|null, graceDays, tokenExpiresAt, nonce, serverTime, integrityPolicy, crlVersion, kid`.
3. **تمدید خودکار:** هر ساعت `checkin` (با telemetry) → توکن تازه (پیش‌فرض اعتبار ۱۴ روز). پاسخ فقط با امضا + `nonce` + پنجره‌ی ±۳۰۰ ثانیه + هویت همخوان پذیرفته می‌شود (ضد MITM/replay).
4. **آفلاین:** توکن تا `tokenExpiresAt` معتبر؛ سپس `graceDays` هشدار پلکانی (سطح ۱ اطلاع، ۲ هشدار، ۳ بحرانی)؛ بعد **قفل سخت**. قطع اینترنت هرگز قفل فوری نمی‌دهد.
5. **تعلیق/ابطال:** حکم امضاشده (`license_suspended/revoked`) در check-in بعدی فوراً اعمال و در state ماندگار می‌شود؛ CRL امضاشده هم برای توکن‌های آفلاین پخش می‌شود. با قفل، **همه‌ی cronها متوقف** می‌شوند و `LicenseGuard` همه‌ی مسیرها (به‌جز وضعیت لایسنس/سلامت) را می‌بندد.
6. **سرور بدون اینترنت:** ادمین «توکن آفلاین» (مقید به `installationId`، عمر دلخواه تا ~۳ سال) صادر می‌کند؛ پیش از انقضا باید دوباره صادر شود.
7. **کپی نصب:** اثرانگشت/`installationId` تغییرِ عمده (machine-id دیگر) → `fingerprint_mismatch`؛ کلاینت با شناسه‌ی جدید دوباره فعال می‌شود که **یک ظرفیت مصرف می‌کند** (با `maxActivations=1` نصب کپی قفل می‌ماند و نصب اصلی ادامه می‌دهد).

### سطوح اعمال (چند نقطه‌ی کنترل، نه یک `if`)
`LicenseGuard` (سراسری، همه‌ی درخواست‌ها) · `ModuleGuard` (هر ماژول: باید در `modules` توکن باشد؛ هسته آزاد) · `UsersService.inviteUser` (سقف `maxUsers`) · توقف مرکزی cronها با `SchedulerRegistry` · بوت‌استرپ (بدون لایسنس معتبر تننت نمی‌سازد) · راستی‌آزمای یکپارچگی · همگام‌سازی `TenantModule` با ماژول‌های توکن.

## ۳. API عمومی (`/api/license-api`)

فقط **POST** (کلید در URL/لاگ دسترسی نیفتد — انحراف آگاهانه از مرجع که GET هم می‌پذیرفت). بدنه JSON. بدون ورود. محدودیت: ۶۰ درخواست/دقیقه/IP + قفل نمایی IP پس از ۸ شکستِ «حدس کلید» (۱، ۲، ۴… دقیقه تا ۲۴ ساعت) + سقف سراسری ۶۰۰/ساعت. پاسخ‌های ناموفق زمان یکسان دارند (۱۵۰–۱۹۰ms).

| endpoint | بدنه |
|---|---|
| `POST /verify` | `license_key`، `identifier?` (بدون شناسه فقط اعتبار کلید) |
| `POST /activate` | `license_key`, `identifier`, `fingerprint[]` (۵ هش hex)، `nonce` |
| `POST /deactivate` | `license_key`, `identifier` — صرف‌نظر از وضعیت لایسنس ظرفیت را آزاد می‌کند |
| `POST /checkin` | مثل activate + `telemetry` (`appVersion, runtimeState, users, modules, clockRollback, tamper{status,modified,added,missing}`) → توکن تازه + `crl` |
| `GET /crl` | CRL امضاشده (هش ۱۶ نویسه‌ی کلیدهای معلق/لغو/حذف‌شده) |
| `GET /public-key` | `kid` و کلید عمومی (فقط برای راه‌اندازی دستی؛ محصول کلید را از بسته‌ی نصب می‌گیرد) |

نمونه:
```bash
curl -sX POST https://license.example.ir/api/license-api/activate -H 'content-type: application/json' \
 -d '{"license_key":"LIC-TEST1-ABCDE-FGHJK-23456","identifier":"i-0f3a…","nonce":"k3Jx9aQw2LmP","fingerprint":["…","…","…","…","…"]}'
```
```json
{ "success": true, "code": "activated", "message": "License activated.",
  "license_key": "LIC-TEST1-ABCDE-FGHJK-23456", "identifier": "i-0f3a…", "timestamp": 1760000000,
  "nonce": "k3Jx9aQw2LmP", "kid": "9c1e4b7a22d0f5aa",
  "data": { "product_name": "exir-erp", "edition": "pro", "status": "active", "expires_at": null,
            "updates_until": "2027-10-01T20:29:59.000Z", "activations": 1, "max_activations": 2 },
  "token": "<base64url(payload)>.<base64url(sig)>", "signature": "<base64url Ed25519>" }
```
`signature` = Ed25519 روی `v2|{1|0}|code|license_key|identifier|timestamp|nonce|kid`. هیچ داده‌ی شخصی (نام/ایمیل مشتری، نام سازمان) در پاسخ نیست.

| code | success | HTTP | معنی |
|---|---|---|---|
| `valid` / `activated` / `already_activated` / `deactivated` | true | 200 | |
| `missing_license_key` | false | 400 | خالی/بلندتر از ۶۴/نویسه‌ی غیرمجاز |
| `missing_identifier` | false | 400 | |
| `license_not_found` | false | 404 | نبود، حذف‌شده، یا هر کلید ناشناخته (بدون افشای پیشوند) |
| `license_suspended` / `license_revoked` / `license_expired` / `not_activated` / `activation_limit_reached` / `fingerprint_mismatch` | false | 403 | |
| `rate_limited` | false | 429 (+`Retry-After`) | |
| `api_disabled` / `server_misconfigured` | false | 503 | |

`activation_limit_reached` و وضعیت‌های لایسنس، `data` را دارند تا محصول ظرفیت را نشان دهد؛ `license_not_found` و خطاهای 400 نه.

## ۴. API مدیریت (فقط ادمین پلتفرم)

`/api/admin/licenses` — `SUPER_ADMIN` برای همه‌ی تغییرات، `BILLING` فقط خواندن فهرست/جزئیات/فعال‌سازی‌ها. ورود کنسول ادمین با JWT و در صورت `ADMIN_REQUIRE_TOTP=true` با **2FA اجباری** است. (CSRF مطرح نیست: Bearer token، نه کوکی.)

`GET /` (فیلتر `q,status=active,expired,suspended,revoked`، صفحه‌بندی) · `GET /export.csv` (خنثی‌سازی formula-injection) · `GET /:id` · `POST /` · `PATCH /:id` (کلید تغییر نمی‌کند) · `POST /:id/renew` (`extendDays | expiresAt | perpetual`, `updatesUntil | updatesUnlimited`) · `POST /:id/suspend` `{reason}` · `POST /:id/resume` · `POST /:id/revoke` `{reason}` · `DELETE /:id` `{reason}` (نرم) · `GET /:id/activations` · `DELETE /:id/activations/:aid` (آزادسازی) · `POST /:id/offline-token` · `GET /events` · `GET|PATCH /settings`.
تاریخ فقط‌روز (`YYYY-MM-DD`) = پایان همان روز به وقت تهران (۲۳:۵۹:۵۹ +۰۳:۳۰). هر عملیات در `license_events` (بدون FK، فقط‌افزودنی) با ادمین/IP/زمان/جزئیات ثبت می‌شود و شکست ثبتِ ردپا، عملیات ادمین را رد می‌کند.

## ۵. مدیریت کلید (مهم‌ترین راز سیستم)

- **تولید (یک‌بار):** `LICENSE_KEY_PASSPHRASE='<≥12 نویسه>' npm run license:keygen` → `keys/license-signing-<kid>.private.pem` (رمزگذاری‌شده AES-256، mode 0600، در `.gitignore`) و `.public.pem`. کلید خصوصی چاپ نمی‌شود.
- **روی سرور لایسنس:** `LICENSE_SIGNING_PRIVATE_KEY_FILE` (مسیر Docker secret / فایل 0400) + `LICENSE_SIGNING_KEY_PASSPHRASE_FILE`. `…_PEM`/`…_PASSPHRASE` مستقیم هم پشتیبانی می‌شود ولی ترجیح داده نمی‌شود. هرگز در DB، git، لاگ یا پنل.
- **بسته‌ی مشتری:** فقط `LICENSE_PUBLIC_KEY_PEM` (می‌تواند چند بلوک PEM داشته باشد = keyring).
- **پشتیبان:** نسخه‌ی آفلاین رمزگذاری‌شده‌ی کلید خصوصی + passphrase در دو محل جدا (password manager و کاغذ/خزانه). **دیتابیس کنترل (لایسنس‌ها، فعال‌سازی‌ها، ردپا) در پشتیبان شبانه‌ی موجود هست** (`docs/disaster-recovery.md`)؛ کلید خصوصی در آن **نیست** و باید جدا بکاپ شود. گم‌شدن کلید = ناتوانی در صدور/تمدید برای همه‌ی نصب‌ها.
- **چرخش کلید (برنامه‌ریزی‌شده):** ۱) `license:keygen` برای کلید جدید ۲) کلید عمومی جدید را **اضافه** کنید به keyring ایمیج‌های بعدی مشتری (`LICENSE_PUBLIC_KEY_PEM` با دو بلوک) و منتظر بمانید نصب‌ها به‌روزرسانی شوند ۳) سپس `LICENSE_SIGNING_PRIVATE_KEY_FILE` را به کلید جدید عوض و سرویس را ری‌استارت کنید (توکن‌های جدید `kid` جدید دارند؛ توکن‌های قبلی تا انقضا با کلید قدیمی معتبرند) ۴) پس از انقضای همه‌ی توکن‌های قبلی، کلید قدیمی را از keyring حذف کنید.
- **کلید لو رفته (اضطراری):** ۱) فوراً `API` را از «تنظیمات» غیرفعال کنید ۲) `kid` لو رفته را در `LICENSE_REVOKED_KIDS` (سرور لایسنس، جداشده با ویرگول) بگذارید → در CRL منتشر می‌شود و نصب‌هایی که به سرور می‌رسند توکن‌های آن `kid` را رد می‌کنند ۳) کلید جدید بسازید و فوراً نسخه‌ی جدید ایمیج با کلید عمومی جدید منتشر کنید (نصب‌های قدیمی که کلید جدید را ندارند باید به‌روزرسانی/توکن آفلاین جدید بگیرند) ۴) ردپا (`license_events`) را برای فعالیت مشکوک بررسی کنید ۵) گزارش حادثه طبق `docs/security/runbook-incident.md`. توجه: تا انتشار کلید عمومی جدید، مهاجمی که کلید را دارد می‌تواند توکن جعلی برای نصب‌هایی که فقط کلید قدیمی را می‌شناسند بسازد — از همین رو سرعت عمل مهم است.

## ۶. متغیرهای محیطی (فقط نام)

سرور لایسنس: `LICENSE_SIGNING_PRIVATE_KEY_FILE` | `LICENSE_SIGNING_PRIVATE_KEY_PEM`، `LICENSE_SIGNING_KEY_PASSPHRASE_FILE` | `LICENSE_SIGNING_KEY_PASSPHRASE`، `LICENSE_TOKEN_VALIDITY_DAYS` (پیش‌فرض ۱۴؛ از «تنظیمات» هم قابل تغییر)، `LICENSE_REVOKED_KIDS`، `RL_LICENSE_API_PER_IP_HOUR`، `ADMIN_REQUIRE_TOTP`.
نصب مشتری: `DEPLOYMENT_MODE=ON_PREMISE`، `LICENSE_KEY`، `LICENSE_PUBLIC_KEY_PEM` (یا `LICENSE_PUBLIC_KEY_FILE`)، `LICENSE_SERVER_URL` (قدیمی: `CONTROL_PLANE_CHECKIN_URL`)، `LICENSE_TOKEN` (آفلاین)، `LICENSE_STATE_DIR`، `LICENSE_CHECKIN_INTERVAL_MS`، `APP_VERSION`، `BUILD_DATE`، `INTEGRITY_VERIFY` / `INTEGRITY_DIST_DIR`، `HOST_MACHINE_ID`.
بیلد: `MANIFEST_REQUIRED`، `APP_VERSION`، BuildKit secrets `license_signing_key` / `license_signing_passphrase`.

## ۷. یکپارچگی بیلد (مانیفست امضاشده)

`npm run build:manifest` (در Dockerfile با BuildKit secret اجرا می‌شود و کلید در هیچ لایه‌ای نمی‌ماند):
```bash
docker build -f apps/backend-core/Dockerfile \
  --secret id=license_signing_key,src=keys/<kid>.private.pem \
  --secret id=license_signing_passphrase,src=pass.txt -t registry/exir/backend:1.4.0 .
```
`dist/integrity.manifest` = SHA-256 همه‌ی فایل‌های `dist` (js/json) امضاشده. زمان اجرا (بوت + هر ۶ ساعت) فایل‌ها بازبینی می‌شود: `ok | tampered | manifest_missing | manifest_invalid`. نتیجه در check-in گزارش می‌شود و در پنل (چیپ «دستکاری کد») نشان داده می‌شود. **سیاست را توکن امضاشده تعیین می‌کند (نه env مشتری):** `WARN` (پیش‌فرض: لاگ + گزارش) یا `LOCK` (قفل). برای اجتناب از قفل تصادفی، مدتی با `WARN` کار کنید و پس از اطمینان از نبود مثبت کاذب `LOCK` را برای مشتریان خاص فعال کنید.

## ۸. دفترچه‌ی عملیات

| کار | روش |
|---|---|
| صدور | پنل «مدیریت لایسنس» ← صدور؛ یا `npm run license:issue -- --org … --modules crm,accounting --seats 25 --activations 1 [--expires YYYY-MM-DD \| --perpetual] [--updates-until …]`. کلید + راهنمای نصب را برای مشتری بفرستید. |
| تمدید پشتیبانی/اشتراک | «تمدید»: افزودن روز / تاریخ / دائمی؛ `updatesUntil`. نصب‌ها در check-in بعدی توکن جدید می‌گیرند. |
| ارتقا (ماژول/کاربر بیشتر) | «ویرایش» ← ماژول/سقف کاربر؛ در check-in بعدی اعمال و `TenantModule` همگام می‌شود. |
| تعلیق (عدم پرداخت) | «تعلیق» + دلیل؛ برگشت: «ازسرگیری». حداکثر تأخیر = بازه‌ی check-in (۱ ساعت). |
| ابطال | «لغو» (برگشت‌ناپذیر) → CRL. |
| انتقال سرور مشتری | فعال‌سازی قدیمی را «آزادسازی» کنید؛ نصب جدید خودکار فعال می‌شود. |
| سرور آفلاین | «توکن آفلاین» با `installationId`. |
| مشکوک به کپی/اشتراک‌گذاری کلید | «فعال‌سازی‌ها» (IP/نسخه/اثرانگشت) و «ردپا»؛ سقف فعال‌سازی را کم یا لایسنس را تعلیق کنید. |
| آزمایش | چک‌لیست بخش ۹ |

## ۹. چک‌لیست تست دستی (سناریوی مرجع)
لایسنس با `maxActivations=2`، بدون انقضا: ۱) activate `example.com` → `activated` ۲) تکرار → `already_activated` (تعداد ۱) ۳) activate `https://www.Test-Site.org/path` → `activated` (شناسه `test-site.org`) ۴) activate سوم → `activation_limit_reached` ۵) verify `example.com` → `valid` ۶) verify ناشناس → `not_activated` ۷) verify بدون identifier → `valid` ۸) تعلیق → `license_suspended` ۹) deactivate `example.com` → `deactivated` (حتی معلق) ۱۰) activate سوم هنوز `license_suspended`؛ بعد از ازسرگیری → `activated` ۱۱) کلید اشتباه → `license_not_found` (404) ۱۲) انقضای گذشته → `license_expired`. همه‌ی این‌ها در `license-public.service.spec.ts` خودکار تست شده‌اند. تست‌های دیگر: امضا/جعل/replay/grace/rollback (`license-crypto.spec.ts`)، اجرای کامل کلاینت (`license-runtime.service.spec.ts`)، یکپارچگی (`integrity-manifest.spec.ts`)، نرخ/قفل (`license-throttle.spec.ts`)، ادمین/ردپا (`license-admin.service.spec.ts`)، `ModuleGuard`.

## ۱۰. حریم خصوصی تلمتری
check-in فقط می‌فرستد: نسخه‌ی برنامه، وضعیت لایسنس، **تعداد** کاربران و ماژول‌ها، وضعیت/شمارنده‌ی یکپارچگی، پرچم برگشت ساعت، `installationId`، هش‌های اثرانگشت (غیرقابل بازگشت) و IP شبکه. **هیچ** داده‌ی کسب‌وکاری، نام کاربر، شماره، محتوای دیتابیس یا مسیر فایل ارسال نمی‌شود؛ سرور هر فیلد ناشناخته را دور می‌ریزد. این موضوع باید در قرارداد/راهنمای مشتری آمده باشد (`license-terms-fa.md`).

## ۱۱. سخت‌سازی پس از بازبینی امنیتی

- **deactivate توسط کلاینت اسلات را فوری آزاد نمی‌کند:** چون توکن صادرشده تا (اعتبار توکن + `graceDays`) آفلاین کار می‌کند، اسلات تا `lastTokenAt + tokenValidityDays + graceDays` «اشغال» می‌ماند (فقط برای همان `identifier` احیا می‌شود). آزادسازی فوری فقط توسط ادمین. `graceDays` پیش‌فرض لایسنس جدید ۷ روز است (قابل‌تنظیم برای هر لایسنس).
- **TLS:** `LICENSE_SERVER_URL` با `http://` رد می‌شود مگر `LICENSE_ALLOW_INSECURE=true` (هشدار بلند). پاسخ‌ها redirect دنبال نمی‌کنند و سقف ۶۴KB دارند. CRL قبل از ذخیره: امضا، `v=1`، نوع آرایه‌ها، `kid` در keyring، و نسخه‌ی ≥ نسخه‌ی ذخیره‌شده؛ و SHA-256 آن داخل رشته‌ی امضاشده‌ی پاسخ است.
- **v1 منسوخ:** توکن‌های قدیمی v1 فعلاً پذیرفته می‌شوند (با هشدار deprecation در لاگ و `deprecated: "legacy_v1"` در `/license/status`). با `LICENSE_ALLOW_LEGACY_V1=false` رد می‌شوند. **مهلت حذف: 2027-03-31** (پس از آن کد v1 حذف می‌شود؛ مشتریان باید توکن v2 بگیرند).
- **updatesUntil:** فقط تاریخ ساختِ مانیفست امضاشده معتبر است (`BUILD_DATE` در env نادیده گرفته می‌شود). نبود مانیفست ⇒ تاریخ ساخت نامعلوم ⇒ هشدار؛ با سیاست `LOCK` در production قفل. بیلد Docker بدون BuildKit secret **خطا می‌دهد** مگر `--build-arg ALLOW_UNSIGNED_BUILD=true` (compose داخلی ما این را true می‌گذارد؛ pipeline release نباید).
- **کلید امضا:** `.dockerignore` دیگر `keys/`, `*.pem`, `*.key`, `.env*` را وارد build context نمی‌کند. فایل کلید خصوصی با **scrypt (N=2^16) + AES-256-GCM** رمزگذاری می‌شود (`license:keygen` حداقل ۱۶ نویسه). در production passphrase فقط از `LICENSE_SIGNING_KEY_PASSPHRASE_FILE` پذیرفته می‌شود. *(کلید جدا برای امضای مانیفست build عمداً انجام نشد؛ بخش «باقی‌مانده» گزارش.)*
- **DoS:** بدنه‌ی `/api/license-api/*` حداکثر ۴KB؛ `rate_limited` هرگز در DB نوشته نمی‌شود؛ رویدادهای PUBLIC/CHECKIN/SYSTEM بیش از ۹۰ روز (`LICENSE_EVENT_RETENTION_DAYS`) پاک می‌شوند (رویدادهای ADMIN هرگز)؛ IPv6 روی /64؛ جدول‌های throttle سقف سخت دارند؛ قفل حداکثر ۱۵ دقیقه و نصب‌هایی که اخیراً از همان IP با شناسه‌ی نصب معتبر موفق بوده‌اند (CGNAT) از قفل معاف‌اند.
- **BILLING:** کلید فقط به شکل `•••` + ۸ نویسه‌ی آخر؛ مشاهده‌ی جزئیات کامل و export فقط SUPER_ADMIN و با رویداد `key_view` / `key_export` در ردپا.
- **اتمیک بودن:** تغییر + ردپا در یک تراکنش DB؛ افزایش نسخه‌ی CRL با `INSERT … ON CONFLICT … RETURNING`. توکن آفلاین (پنل و CLI) از `issueOfflineTokenCore` عبور می‌کند: اعتبارسنجی `installationId`، سقف ۱۱۰۰ روز، فقط لایسنس فعال، ظرفیت با قفل ردیف.
- **2FA ادمین:** `ADMIN_REQUIRE_TOTP=true` در `.env.on-premise.example` پیش‌فرض است (پیش از فعال‌سازی همه‌ی ادمین‌ها از صفحه‌ی «امنیت» ثبت‌نام کنند).

## گزارش چرخش کلید — ۲۰ اکتبر ۲۰۲۶

- **علت:** کلید خصوصی توسعه‌ی قدیمی (`kid d7933ca40875b116`، بدون رمز) در یک گفتگوی توسعه چاپ شد. روی سرور تولید هرگز تنظیم نشده بود، ولی کلید عمومی‌اش به‌عنوان `LICENSE_PUBLIC_KEY_PEM` مورد اعتماد توکن آزمایشی قدیمی بود.
- **اقدام:** کلید جدید رمزنگاری‌شده روی خود سرور ساخته شد (`kid c31954e105c7f8e9`، فایل‌ها در `/opt/exir-erp/secrets/license`، فقط‌خواندنی برای کاربر بک‌اند، عبارت عبور تصادفی فقط به‌صورت فایل). `LICENSE_KEY` و `LICENSE_PUBLIC_KEY_PEM` قدیمی از `.env` سرور حذف شد، `LICENSE_REVOKED_KIDS=d7933ca40875b116` ثبت شد، فایل کلید قدیمی از رایانه‌ی توسعه حذف شد. تأیید: `GET /api/license-api/crl` همان kid را باطل‌شده نشان می‌دهد.
- **سرور ابری ما:** `DEPLOYMENT_MODE=CLOUD` (نه ON_PREMISE). با ON_PREMISE و توکن آزمایشی ۶‌ماژوله، ModuleGuard همه‌ی ماژول‌های دیگر را رد می‌کرد.
- **نسخه‌ی آفلاین:** مالک باید از `signing.private.pem` و `passphrase` یک نسخه‌ی آفلاین جدا بگیرد (بدون آن، لایسنس‌های صادرشده قابل تمدید نیستند).
