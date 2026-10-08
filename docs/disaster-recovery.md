# بازیابی از فاجعه و بکاپ (Disaster Recovery)

هدف: در **بدترین حالت** (از دست رفتن دیسک یا کل سرور، حذف اشتباهی، نفوذ) داده‌ها سریع برگردند؛ بکاپ‌ها حجم زیادی
نگیرند؛ و **در هیچ شرایطی** داده برای نفوذگر قابل‌خواندن نباشد.

## ۱. خلاصه‌ی طراحی

| موضوع | رفتار |
|---|---|
| چه چیزی بکاپ می‌شود | هر شب ساعت ۰۲:۰۰: دیتابیس **کنترل** (`exir_control`: تننت‌ها، کاربران، عضویت‌ها، فاکتورها، کلید API، لایسنس‌ها، اشتراک‌ها) + دیتابیس **هر تننت فعال** |
| روش | `pg_dump` متن SQL ساده (`--clean --if-exists --no-owner --no-privileges`) ← `gzip -9` ← رمزنگاری AES-256-GCM ← فایل `<YYYY-MM-DD>.sql.gz.enc` |
| محل | `./backups/<slug>/` و `./backups/_control/` روی میزبان (mount شده در `/app/backups`) |
| دسترسی فایل | پوشه‌ها `0700`، فایل‌ها `0600`؛ هنگام بوت، مجوزهای سست قدیمی هم خودکار اصلاح می‌شوند |
| رمزنگاری | با `BACKUP_ENCRYPTION_KEY`. بدون کلید: بکاپ رمزنگاری‌نشده نوشته می‌شود **ولی هرگز به S3 نمی‌رود** و هشدار می‌دهد. با `BACKUP_REQUIRE_ENCRYPTION=true` بدون کلید اصلاً چیزی ذخیره نمی‌شود. بکاپ‌های متنی قدیمی هنگام بوت (اگر کلید باشد) در جا رمزنگاری و نسخه‌ی متنی حذف می‌شود |
| کپی خارج از سرور | S3-سازگار (آروان‌کلاود / MinIO / AWS). فقط فایل **رمزنگاری‌شده**؛ multipart برای فایل‌های بزرگ؛ retry با backoff؛ تأیید اندازه و sha256 بعد از آپلود؛ پیشوند جدا برای هر محیط (`exir-<BACKUP_ENV_NAME>/<slug>/…`) |
| نگهداری (GFS) | ۷ روزانه + ۴ هفتگی (یکشنبه) + ۶ ماهانه (اول ماه) — محلی و راه دور با همان سیاست؛ جدیدترین بکاپ هرگز حذف نمی‌شود |
| صحت | هش sha256 در `manifest.json` کنار هر پوشه؛ بعد از هر بکاپ بازخوانی از دیسک (هش + رمزگشایی فریم اول + gzip)؛ **هر یکشنبه ۰۴:۰۰ آزمون بازیابی کامل** (کنترل + بزرگ‌ترین تننت) در دیتابیس موقت `exir_restore_check_<hex>` که بلافاصله حذف می‌شود |
| هشدار | ErrorLog پلتفرم (`service=backup`) + پیامک به `BACKUP_ALERT_PHONE` (پیش‌فرض: `ON_PREM_OWNER_PHONE`)، حداکثر یک بار در روز برای هر نوع خطا. شکست بکاپ/آپلود/آزمون بازیابی، افت ناگهانی حجم، و «بیش از ۲۶ ساعت بدون بکاپ موفق» |
| مشاهده | پنل ادمین ← «بکاپ و بازیابی» (`GET /admin/backups/status`، فقط SUPER_ADMIN) با دکمه‌های «اجرای بکاپ» و «آزمون بازیابی» |

### قالب فایل رمزنگاری‌شده (EXBK v1)
`"EXBK"(4) | version(1) | chunkLog2(1) | keyId(4) | salt(16)` سپس فریم‌های `flag(1) | len(u32) | ciphertext+tag(16)`.
کلید هر فایل = `HKDF-SHA256(masterKey, salt)`؛ nonce = شمارنده‌ی فریم؛ AAD = هدر + شماره‌ی فریم + پرچم «آخرین فریم».
در نتیجه دستکاری، جابه‌جایی، حذف یا بریده‌شدن فایل **حتماً** شناسایی می‌شود. gzip قبل از رمزنگاری انجام می‌شود.

## ۲. RPO / RTO

| سناریو | RPO (حداکثر داده‌ی از دست‌رفته) | RTO تقریبی | راهنما |
|---|---|---|---|
| حذف/خرابی داده‌ی یک تننت | تا ۲۴ ساعت (بکاپ شبانه) | ۱۰–۳۰ دقیقه | §۵ الف |
| خرابی دیتابیس کنترل | تا ۲۴ ساعت | ۱۵–۳۰ دقیقه | §۵ ب |
| از دست رفتن کل سرور | تا ۲۴ ساعت (آخرین نسخه‌ی روی S3) | ۲–۴ ساعت (نصب + build ایمیج‌ها + restore) | §۵ ج |
| نفوذ/باج‌افزار روی سرور | تا ۲۴ ساعت؛ بکاپ S3 مستقل از سرور است (برای مصون‌ماندن از حذف توسط نفوذگر، کلید S3 سرور را **فقط write/list** و حذف را با lifecycle/versioning سمت ارائه‌دهنده انجام بده) | ۲–۴ ساعت | §۵ ج |

RPO یک روز است چون بکاپ منطقی شبانه است. اگر کمتر لازم شد: افزودن WAL archiving/PITR (خارج از این فاز) یا اجرای دستی «اجرای بکاپ» پیش از تغییرات پرریسک.

## ۳. حجم دیسک (تخمین)

فرمول: `حجم ≈ تعداد فایل نگه‌داشته‌شده × حجم یک بکاپ فشرده`، رمزنگاری فقط ~۰٫۰۱٪ اضافه می‌کند.
با سیاست پیش‌فرض حداکثر ۷+۴+۶ = **۱۷ فایل** برای هر دیتابیس (در عمل ۱۳–۱۷ چون بعضی روزها هم‌پوشانی دارند).

| تننت | حجم یک بکاپ | قبلاً (۱۴ روز) | سیاست جدید (≤۱۷ فایل، پوشش ۶ ماه) |
|---|---|---|---|
| تننت بزرگ مثل eta | ≈ ۷۰ MB | ≈ ۹۸۰ MB | ≈ ۱٫۲ GB |
| تننت متوسط (۱۰ MB) | ۱۰ MB | ۱۴۰ MB | ≈ ۱۷۰ MB |
| دیتابیس کنترل | چند MB | — | < ۱۰۰ MB |

اگر دیسک تنگ است: `BACKUP_KEEP_DAILY=5 BACKUP_KEEP_WEEKLY=3 BACKUP_KEEP_MONTHLY=3` (≤ ۱۱ فایل ≈ ۷۷۰ MB برای eta). فضای S3 تقریباً همین‌قدر است.

فشرده‌سازی: روی نمونه‌ی واقعی، `gzip -9` فقط ~۰٫۵٪ از `gzip -6` بهتر است؛ `zstd -19`/brotli حدود ۱۵–۲۰٪ کوچک‌تر ولی (الف) روی Node 20 داخل کانتینر zstd ندارد، (ب) فرمان نجات `gunzip | psql` را از بین می‌برد. تصمیم: **gzip -9**؛ صرفه‌جویی اصلی از GFS می‌آید نه الگوریتم.

## ۴. اسرار حیاتی که باید **خارج از سرور** نگه داری

بدون این‌ها بازیابی کامل ممکن نیست. در password manager یا یک محل آفلاین (نه روی همان سرور، نه فقط روی S3):

1. **`BACKUP_ENCRYPTION_KEY`** ← مهم‌ترین مورد. **با گم شدن آن همه‌ی بکاپ‌ها (از جمله نسخه‌ی S3) برای همیشه غیرقابل‌خواندن‌اند.** تولید: `openssl rand -hex 32`. پیشنهاد: دو نسخه در دو محل مستقل.
2. `POSTGRES_PASSWORD`، `JWT_SECRET`
3. `TAX_SECRETS_KEY` (بدون آن کلیدهای خصوصی مودیان در دیتابیس بازیابی‌شده قابل‌رمزگشایی نیستند)
4. `LICENSE_KEY`, `LICENSE_PUBLIC_KEY_PEM`, و در صورت وجود `LICENSE_SIGNING_PRIVATE_KEY_PEM` / فایل `apps/backend-core/keys/*.pem` (در git نیستند)
5. `BACKUP_S3_*` (endpoint، bucket، access/secret key)، `EXIR_SMS_API_KEY`/`EXIR_SMS_SENDER_LINE`، `ZARINPAL_MERCHANT_ID`، `VAPID_*`، `BAHA24_API_KEY`
6. یک کپی از کل فایل `.env` سرور (رمزنگاری‌شده) — این فایل همه‌ی موارد بالا را دارد.

## ۵. Runbookها

پیش‌نیاز همه: `node` ≥ 18 و `gunzip` روی ماشین (برای `scripts/backup-decrypt.mjs`)، و کلید در محیط:
`export BACKUP_ENCRYPTION_KEY=...` (یا `--key-file /secure/path`؛ کلید را روی خط فرمان ننویس).
اسکریپت‌ها **پیش‌فرض dry-run** هستند (فقط صحت فایل را کامل بررسی و برنامه را چاپ می‌کنند)، با `--yes` اعمال می‌شوند،
روی دیتابیس غیرخالی بدون `--force` امتناع می‌کنند (و با `--force` اول یک dump ایمنی از وضعیت فعلی می‌گیرند)،
و کل restore را در **یک تراکنش** انجام می‌دهند (شکست = دیتابیس دست‌نخورده).

### الف) بازیابی یک تننت
```bash
cd /opt/exir-erp
export BACKUP_ENCRYPTION_KEY=...                      # از password manager
ls backups/acme/                                      # یا دانلود از S3 (§۶)
./scripts/restore-tenant.sh --docker --file backups/acme/2026-10-08.sql.gz.enc --db exir_tenant_acme            # dry-run
./scripts/restore-tenant.sh --docker --file backups/acme/2026-10-08.sql.gz.enc --db exir_tenant_acme --yes --force
```
نام دیتابیس: `exir_tenant_<slug با - → _>` (یا ستون `dbName` جدول `tenants`). برای «بدون ریسک»، اول در نام دیگری
(`exir_tenant_acme_restored`) بازیابی و مقایسه کن، بعد با تغییر `dbName` در جدول `tenants` یا restore روی نام اصلی جایگزین کن.
پس از restore: `docker compose -f docker-compose.on-premise.yml restart backend` (کش اتصال تننت پاک شود) و ورود آزمایشی به تننت.

### ب) بازیابی دیتابیس کنترل
```bash
docker compose -f docker-compose.on-premise.yml stop backend
./scripts/restore-control.sh --docker --file backups/_control/2026-10-08.sql.gz.enc            # dry-run
./scripts/restore-control.sh --docker --file backups/_control/2026-10-08.sql.gz.enc --yes --force
docker compose -f docker-compose.on-premise.yml up -d backend     # entrypoint مایگریشن‌ها را اجرا می‌کند
```
بعد از آن: `SELECT slug, "dbName", status FROM tenants;` را ببین و مطمئن شو دیتابیس هر تننت وجود دارد.

### ج) از دست رفتن کامل سرور (سرور جدید Ubuntu)
1. سرور جدید + دسترسی SSH. `apt update && apt install -y docker.io docker-compose-v2 git nodejs rsync`
   (Node ≥ 18 فقط برای `backup-decrypt.mjs` روی میزبان؛ از nodesource نصب کن اگر نسخه‌ی apt قدیمی است). سخت‌سازی سرور: `infra/hardening/`.
2. کد: `git clone <repo> /opt/exir-erp && cd /opt/exir-erp` (یا `scripts/deploy.sh`).
3. `.env`: از کپی خارج از سرور (§۴) برگردان. **همان** `BACKUP_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `TAX_SECRETS_KEY`, `LICENSE_*` را بگذار.
4. فقط PostgreSQL را بالا بیاور: `docker compose -f docker-compose.on-premise.yml up -d postgres` (تا healthy شود).
5. بکاپ‌ها را از S3 بیاور (§۶) به `./backups/` (`chmod -R go-rwx backups`).
6. **اول کنترل** (backend هنوز بالا نیامده): `./scripts/restore-control.sh --docker --file backups/_control/<آخرین>.sql.gz.enc --yes`
7. لیست تننت‌ها: `docker compose -f docker-compose.on-premise.yml exec -T postgres psql -U postgres -d exir_control -tAc 'SELECT slug, "dbName" FROM tenants WHERE status='"'"'ACTIVE'"'"''`
8. برای هر تننت: `./scripts/restore-tenant.sh --docker --file backups/<slug>/<آخرین>.sql.gz.enc --db <dbName> --yes`
9. بقیه: `docker compose -f docker-compose.on-premise.yml up -d --build` (entrypoint مایگریشن‌ها را روی دیتابیس‌های بازیابی‌شده اعمال می‌کند).
10. DNS/IP را به سرور جدید منتقل کن. 
11. **تأیید:** ورود به پنل ادمین ← «بکاپ و بازیابی» ← «اجرای بکاپ»؛ ورود به یک تننت واقعی و دیدن آخرین فاکتور؛ لاگ backend بدون خطا؛ فردا صبح هشداری نیامده باشد.
12. کلیدها/توکن‌هایی که ممکن است روی سرور قبلی لو رفته باشند (اگر علت فاجعه نفوذ بود) را بچرخان: `JWT_SECRET`، رمز Postgres، کلیدهای S3، API keyها.

### د) چطور بکاپ را آزمایش کنیم
- خودکار: هر یکشنبه ۰۴:۰۰؛ نتیجه در پنل ادمین. دستی: دکمه‌ی «اجرای آزمون بازیابی».
- دستی روی هر ماشین: `node scripts/backup-decrypt.mjs --verify file.sql.gz.enc` (همه‌ی فریم‌ها را احراز اصالت می‌کند) و
  `node scripts/backup-decrypt.mjs file.sql.gz.enc | gunzip | psql <db>` (با `set -o pipefail`؛ روی دیتابیس **خالی**).
- فایل را عمداً دستکاری کن و ببین رد می‌شود (باید خطای `authentication failed` بدهد).

### ه) تمرین فصلی (هر ۳ ماه، حدود ۴۵ دقیقه)
- [ ] کلید `BACKUP_ENCRYPTION_KEY` را از password manager (نه از سرور) بردار و با آن یک فایل را `--verify` کن.
- [ ] آخرین بکاپ eta و `_control` را **از S3** (نه از دیسک سرور) دانلود کن؛ اندازه و تاریخ درست است؟
- [ ] روی یک ماشین/VM تمیز: Postgres بالا بیاور، `restore-control.sh` و `restore-tenant.sh` اجرا کن؛ ورود و چند گزارش را چک کن.
- [ ] زمان کل را بنویس و با RTO جدول مقایسه کن؛ اختلاف را در همین سند اصلاح کن.
- [ ] پنل «بکاپ و بازیابی» هشدار ندارد؛ آخرین آزمون خودکار موفق است؛ پیامک هشدار را با قطع موقت S3 (در staging) امتحان کن.
- [ ] کلید S3 و دسترسی‌ها: فقط write/list برای سرور؟ دسترسی افراد به کلید رمزنگاری به‌روز است؟
- [ ] گردش کلید (سالانه): کلید جدید بساز؛ `BACKUP_ENCRYPTION_KEY` را عوض کن؛ **کلید قدیمی را تا انقضای آخرین بکاپ قدیمی (≈ ۶ ماه) نگه دار**.

## ۶. گرفتن بکاپ از S3
فایل‌ها در `exir-<BACKUP_ENV_NAME>/<slug>/<date>.sql.gz.enc` هستند (برای کنترل: `…/_control/…`). با هر ابزار S3 (`aws s3 cp --endpoint-url …`,
`mc cp`, `rclone`). فایل بدون کلید بی‌ارزش است؛ بنابراین ذخیره روی ارائه‌دهنده‌ی S3 ریسک افشا ندارد. sha256 هر شیء در metadata (`x-amz-meta-sha256`) هم هست.

## ۷. محدودیت‌ها و نکات
- بکاپ منطقی شبانه است (نه PITR). تغییرات بین ۰۲:۰۰ و لحظه‌ی فاجعه از دست می‌رود.
- `psql` در آزمون بازیابی با `ON_ERROR_STOP=1` اجرا می‌شود: هر خطا = آزمون ناموفق (عمداً سخت‌گیر).
- دیتابیس‌های موقت آزمون فقط با الگوی `exir_restore_check_<۱۲hex>` و فقط اگر همان job ساخته باشد حذف می‌شوند؛ اگر پردازه وسط آزمون کشته شد، بار بعد پاک می‌شوند.
- اگر `BACKUP_ENCRYPTION_KEY` عوض شود، بکاپ‌های قبلی با کلید قدیمی خوانده می‌شوند (نگه‌دار!) و آزمون بازیابی هفتگی تا بکاپ بعدی ممکن است با «کلید اشتباه» شکست بخورد.
- دانلود دستی تننت (`/settings/backup/export`) همچنان یک SQL فشرده‌ی **رمزنگاری‌نشده** به خود کاربر OWNER/ADMIN می‌دهد؛ این فایل را مثل رمز عبور نگهداری کنید.
