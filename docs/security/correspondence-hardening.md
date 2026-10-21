# سخت‌سازی ماژول مکاتبات

## Chromium (تولید PDF نامه و فاکتور)
- `src/common/chromium-launch.ts`: env حداقلی (`PATH`، `HOME`، `LANG`)، فلگ‌های `--disable-dev-shm-usage --disable-gpu --disable-extensions --js-flags=--jitless`.
- برای هر رندر `browser.createBrowserContext()` تازه ساخته و بعد از رندر بسته می‌شود؛ مرورگر هر `LETTER_PDF_RECYCLE_AFTER` (پیش‌فرض ۱۰۰) رندر بازیافت می‌شود.
- سهم عادلانه: سطل توکن به‌ازای تننت (`LETTER_PDF_TENANT_BURST/PER_MIN`) و کاربر (`LETTER_PDF_USER_BURST/PER_MIN`)؛ rate-limit مسیرهای `GET /correspondence/letters/:id/pdf|slip` (`RL_CORR_PDF_PER_MIN`، قانون `corr-pdf-token`)؛ کش ۶۰ثانیه‌ای PDF زنده؛ یک slot رزرو فقط برای فاز ۲ امضا.
- **Sandbox**: در تصویر فعلی (کاربر غیرروت `exir`، Alpine + `chromium`، Docker با seccomp پیش‌فرض) user-namespace در دسترس نیست و Chromium با sandbox بالا نمی‌آید (بدون `CAP_SYS_ADMIN` یا seccomp سفارشی). بنابراین پیش‌فرض `--no-sandbox` است و **روشن‌کردنش بدون تغییر زیرساخت ممکن نیست** (در این مرحله روی سرور آزموده نشد). میزبانی که userns دارد با `CHROMIUM_SANDBOX=1` آن را روشن می‌کند. جبران: JS خاموش، قطع هر درخواست غیر `data:`، context تازه، env حداقلی، jitless، اعتبارسنجی ابعاد تصویر (≤۲۵ مگاپیکسل و ضلع ≤۸۰۰۰)، timeout سخت با بستن صفحه‌ها.

## نامه‌های «سری» و پشتیبان/خروجی
- پشتیبان `pg_dump` کل دیتابیس تننت (از جمله `corr_letters`) را می‌گیرد؛ محافظت فقط با رمزنگاری پشتیبان (`BACKUP_ENCRYPTION_KEY`) است و بدون آن هشدار «UNENCRYPTED» لاگ می‌شود. دسترسی به فایل پشتیبان = دسترسی به همه‌ی نامه‌ها؛ فقط مالک/عملیات.
- خروجی دفتر ثبت (CSV) در دامنه‌ی دید کاربر ساخته می‌شود؛ نامه‌ی «سری» فقط برای OWNER (یا مشارکت‌کنندگان) در آن می‌آید.
- خروج کاربر: نامه‌های «سری» و پیش‌نویس‌ها خودکار منتقل نمی‌شوند (هشدار `NEEDS_OWNER`)؛ انتقال دستی فقط با مالک.

## جست‌وجو
- نویسه‌های `% _ \` در ورودی جست‌وجو به فاصله تبدیل می‌شوند (Prisma در `contains` آن‌ها را escape نمی‌کند).

## بلوک امضا، شماره‌ی صفحه و سربرگ PDF (اصلاحات بازخورد مالک)
- **بلوک امضا**: ستون `corr_letters.signatureBlock` (JSON، مایگریشن `20261022100000_correspondence_refinements`). null/`{}` = خودکار. هنگام امضا، فیلدها و دو خط نهایی (`titleLine`/`nameLine`) در نامه ثابت و در `contentHash`/snapshot می‌آیند؛ تغییر بعدی تنظیمات روی نامه‌ی امضاشده اثر ندارد. کلاینت هرگز خطوط نهایی را نمی‌فرستد (سرور حذف می‌کند). پیش‌فرض‌ها در `ModuleSetting(correspondence, signatureDefaults)`؛ قالب‌ها فقط `{{signerTitle}} {{orgName}} {{signerName}} {{honorific}}` و خروجی همیشه escape می‌شود.
- **شماره‌ی صفحه**: کادر `pageNumber` در `layoutJson` + `pageNumberOptions` (قالب، شروع از صفحه، صفحه‌ی اول، تک‌صفحه، ارقام فارسی). چیدمان‌های قدیمیِ بدون این کلیدها هنگام خواندن با پیش‌فرض پر می‌شوند (`withLayoutDefaults`) و نیازی به backfill نیست.
- **سربرگ PDF**: فقط در مرورگر با pdf.js (بارگذاری تنبل، worker از bundle) به تصویر ۳۰۰dpi تبدیل می‌شود؛ سرور هیچ PDFی را پردازش نمی‌کند و فقط PNG/JPEG/WebP تا ۶ مگابایت و ۲۵ مگاپیکسل را می‌پذیرد. CSP پنل `Report-Only` است و `worker-src` جدا ندارد (از `default-src 'self'` پیروی می‌کند) پس worker هم‌مبدأ مشکلی ندارد.
- **نام کاربر**: تغییر نام در `PATCH /me/profile` در GlobalUser و User/Employee همه‌ی محیط‌های کاری همگام می‌شود (best-effort)، در ActivityLog ثبت می‌شود و سوابق تاریخی (اسنپ‌شات نام) دست نمی‌خورد. تصویر پروفایل فقط وقتی عوض شده اعتبارسنجی می‌شود (علت احتمالی خطای قبلی: ارسال همیشگی تصویر قدیمی/لینکی که از سقف فعلی رد می‌شد).
