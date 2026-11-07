# ممیزی CRUD و دسترسی (Create / Read / Update / Delete)

تاریخ: ۱۴۰۵/۰۸ (۲۰۲۶-۱۱-۰۷) — درخواست مالک: «در همه‌ی ماژول‌های موجود و آینده امکان ایجاد، ویرایش، حذف و مشاهده‌ی رکوردها باشد و برای هر کدام سطح دسترسی قابل مدیریت باشد.»

## ۱. روش

- **بک‌اند**: `apps/backend-core/scripts/route-guard-scan.mjs` همه‌ی ۱۷۷ کنترلر (≈۱۳۵۰ مسیر) را می‌خواند و برای هر مسیر تشخیص می‌دهد که خودِ متد یا سرویس‌هایی که صدا می‌زند (تا عمق ۳) یک کنترل دسترسی دارد یا نه (`PermissionsService.assert*` / `getEffective` / `viewScope` / دامنه‌ی دید رکورد / گارد نقش مدیر).
- **UI**: `apps/backend-core/scripts/crud-audit.mjs` فراخوانی‌های `apiFetch` در web-panel را با مسیرهای بک‌اند تطبیق می‌دهد و بررسی می‌کند تابع کلاینت جایی استفاده شده باشد. این تشخیص **تقریبی** است: مسیرهایی که با helper یا متد شرطی ساخته می‌شوند (مثل `saveCategory(id, …)` در مکاتبات یا `post<>` در dispatch) ممکن است `NO` بیایند؛ همه‌ی `NO`های مربوط به U/D دستی بررسی شدند (بخش ۵).
- ماتریس کامل (تولیدشده) در پیوست (بخش ۸) است. علائم: `Y` موجود، `-` وجود ندارد، `X` = مسیر «ابطال/لغو/بایگانی/غیرفعال‌سازی» به‌جای حذف، `·` اصلاً مسیر ندارد، `NO` = مسیر بک‌اند هست ولی در UI پیدا نشد.
- **همیشه‌فعال (تست خودکار)**: `src/permissions/route-guard.spec.ts` اگر مسیر POST/PUT/PATCH/DELETE جدیدی بدون هیچ کنترل دسترسی اضافه شود یا یک DELETE روی رکورد ماژولی `canDelete` را نخواهد، رد می‌شود. `module-catalog-coverage.spec.ts` تضمین می‌کند هر ماژول کاتالوگ در ماتریس دسترسی هست (یا با دلیل خارج است). `default-presets.spec.ts` تضمین می‌کند پیش‌فرض نقش‌ها «حذف» را فقط به «مدیر سیستم» می‌دهد.

## ۲. مدل دسترسی (خلاصه)

هر ماژول در «تنظیمات ← نقش‌ها / دسترسی کاربر» پنج کلید دارد: **مشاهده‌ی همه، مشاهده‌ی خودم، ایجاد، ویرایش، حذف** (`ModulePermission` / `UserModulePermission`، اتحاد نقش‌ها، override کاربر). نگاشت قرارداد:

| عملیات | گارد سرور |
|---|---|
| Create | `assertCreate(ctx, module)` |
| Update (و عملیات‌های وضعیتی غیرحذفی) | `assertEdit` |
| Delete / بایگانی-به‌جای-حذف / ابطال | `assertDelete` (بایگانی/بازیابی ساده‌ی داده‌ی پایه با `assertEdit`) |
| Read | `assertView` (داده‌ی پایه) یا `assertViewAll` / `viewScope` (رکوردهای دارای مالک) |
| UI | `useModuleCan(module)` فقط برای نمایش/مخفی‌کردن دکمه؛ اجبار واقعی سمت سرور |

مدیر (OWNER/ADMIN) همیشه دسترسی کامل دارد. ماژول‌های خارج از ماتریس (با دلیل) در `PERMISSION_MATRIX_EXEMPT_MODULE_CODES` و `OUTSIDE_MATRIX` (تست `module-catalog-coverage.spec.ts`) ثبت‌اند: messenger، operations، checks (زیرمجموعه‌ی فروش/خرید)، offline-sync، supplier-risk (زیر crm)، delivery-signature (زیر sales)، api-access / webhooks / mcp / currency-exchange / payment-gateway (فقط مدیر)، voip، confidential-archive (گاوصندوق شخصی)، livestock-feed (بسته‌ی صنعتی).

## ۳. استثناهای عمدی (حذف/ویرایش ممنوع و جایگزین دارد)

این‌ها نقص نیستند؛ قفل‌های مالی/حقوقی‌اند و نباید حذف شوند:

| موجودیت | رفتار | جایگزین |
|---|---|---|
| سند حسابداری ثبت‌شده، تراکنش بانک/صندوق | حذف/ویرایش ممنوع | ابطال با سند معکوس (`void`)، قفل دوره |
| بانک/صندوق با تراکنش یا سند افتتاحیه | حذف ممنوع (۴۰۹) | غیرفعال‌سازی |
| فاکتور فروش/خرید قطعی، فاکتور امضاشده | حذف ممنوع | ابطال (سند معکوس + برگشت موجودی؛ غیرمدیر → کارتابل) |
| صورتحساب مالیاتی ارسال‌شده | حذف ممنوع | `discard` / ابطال |
| قرارداد امضاشده/فعال/قفل | حذف ممنوع | فسخ (`terminate`)، الحاقیه |
| حرکت انبار | حذف ممنوع | ابطال (`void`) |
| دستور تولید در جریان/تکمیل‌شده | حذف ممنوع | رد (`reject`) — موجودی کسر شده |
| چک | حذف ندارد | لغو (`cancel`) و وضعیت‌های چک؛ ویرایش مستقیم ندارد (سند مالی) |
| گواهی صادرشده | ویرایش ندارد (کد استعلام عمومی ثابت است) | حذف/ابطال و صدور مجدد |
| نامه‌ی ثبت‌شده در مکاتبات | حذف فقط پیش‌نویس | ابطال (`void`)، بایگانی |
| بار در گردش «اعلام بار» | حذف/لغو از ناوگان ممنوع | لغو از صفحه‌ی اعلام بار |
| سند حمل/اعلام بار | گردش وضعیتی | `status`، `resume` |

حذف قطعی فقط وقتی مجاز است که رکورد «بی‌سابقه» باشد (هیچ مرجعی به آن نیست)؛ وگرنه پیام روشن فارسی با تعداد وابستگی‌ها و پیشنهاد **بایگانی** نمایش داده می‌شود (`MasterDeleteDialog` / `DeleteRecordButton` / `safeDelete`). همه‌ی ایجاد/ویرایش/حذف/ابطال به‌صورت خودکار توسط `AuditInterceptor` در لاگ فعالیت ثبت می‌شود (نام مسیر `ماژول.موجودیت.عمل`).

## ۴. باگ گزارش‌شده — ناوگان (Fleet)

| مورد | قبل | بعد |
|---|---|---|
| حذف راننده | `DELETE /fleet/drivers/:id` فقط «غیرفعال» می‌کرد؛ UI هم فقط برای راننده‌ی فعال دکمه‌ی سطل داشت و **راننده‌ی غیرفعال هیچ‌وقت حذف یا بازیابی نمی‌شد** | `DELETE` = حذف قطعی فقط اگر هیچ بار/پیشنهادی ندارد، وگرنه ۴۰۹ با شمارش و پیشنهاد بایگانی؛ `POST :id/archive`، `POST :id/restore`، `GET :id/usage`؛ UI: فیلتر فعال/بایگانی، ویرایش، بازیابی، دیالوگ حذف/بایگانی با تعداد استفاده |
| بار (Shipment) | فقط ایجاد/مشاهده/لغو/تحویل — **بدون ویرایش و بدون حذف** | `PATCH :id` (فقط پیش‌نویس)، `DELETE :id` (فقط پیش‌نویس/لغوشده و خارج از اعلام بار؛ پیوست‌ها هم پاک می‌شوند)، `GET :id/usage`؛ UI: «ویرایش بار»، «حذف بار» |
| «خودرو/وسیله‌ی نقلیه» | موجودیت جدا ندارد — ویژگی راننده است (`vehicleType`, `plateNumber`, `capacityKg`) و با ویرایش راننده تغییر می‌کند | بدون تغییر ساختار |
| مجوزها | `assertView/Create/Edit/Delete('fleet')` | بدون تغییر + مسیرهای جدید طبق جدول بالا |

## ۵. نقص‌های پیدا‌شده و اصلاح‌شده (به ترتیب اولویت)

| # | ماژول / موجودیت | نقص | اصلاح (بک‌اند ← UI) |
|---|---|---|---|
| ۱ | ناوگان: راننده، بار | بخش ۴ | `drivers.*`, `shipments.*` — تست: `src/fleet/fleet-crud.spec.ts` |
| ۲ | حسابداری: بانک، صندوق، دسته‌چک | بدون حذف | `DELETE accounting/banking/{banks,cash-boxes,cheque-books}/:id` (فقط بی‌سابقه؛ غیر آن ۴۰۹ ← غیرفعال/بستن)؛ دکمه‌ی حذف در مودال‌های ویرایش (`banking-lifecycle.service.ts`) |
| ۳ | تولید: دستور تولید | فقط ایجاد/رد؛ بدون ویرایش/حذف | `PATCH production/orders/:id` (فقط DRAFT)، `DELETE` (فقط DRAFT/CANCELLED بدون نمونه‌ی کیفی)؛ دکمه‌ها در جزئیات دستور |
| ۴ | کنترل کیفیت: انواع آزمون | بدون ویرایش/بایگانی/حذف | `PATCH/POST archive|restore/DELETE test-types/:id`؛ فهرست `status=active|archived|all` + `usageCount`؛ `TestTypesManager` |
| ۵ | کنترل کیفیت: نمونه و نتیجه | بدون ویرایش/حذف | `PATCH/DELETE samples/:id`، `DELETE samples/:id/results/:resultId` (حکم نمونه بازمحاسبه می‌شود؛ دستور تکمیل‌شده قفل است)؛ دکمه‌ها در بخش کنترل کیفیت |
| ۶ | HR: حضور و غیاب | فقط upsert؛ ثبت اشتباه پاک نمی‌شد | `DELETE hr/attendance/:id` (`assertDelete('hr')`)؛ دکمه‌ی «حذف ثبت» |
| ۷ | HR: پاداش/جریمه | بدون ویرایش | `PATCH hr/rewards/:id`، `PATCH hr/penalties/:id`؛ فرم ویرایش در پرونده‌ی پرسنلی؛ دکمه‌ی حذف پرسنل پشت `canDelete` |
| ۸ | آزمایشگاه جیره: کد تخفیف | فقط ساخت و غیرفعال‌سازی | `PATCH :id`، `PATCH :id/activate`، `DELETE :id` (فقط استفاده‌نشده)؛ دکمه‌ها |
| ۹ | قراردادها | بدون حذف پیش‌نویس؛ ویرایش (PATCH) هیچ UI نداشت | `DELETE contracts/:id` (فقط DRAFT بدون امضا/قفل/وابسته)؛ `ContractEditPanel` (ویرایش + حذف) |
| ۱۰ | رویدادها | بدون حذف؛ PATCH رویداد و نوع بلیط بدون UI | `DELETE events/:id` (فقط بدون رزرو/بلیط)؛ `EventEditPanel` + ویرایش نوع بلیط |
| ۱۱ | استخدام | PATCH متقاضی و مصاحبه بدون UI | فرم ویرایش متقاضی؛ تغییر زمان و لغو مصاحبه |
| ۱۲ | اعلام بار: نوع سند | بدون حذف | `DELETE dispatch/doc-types/:id` (سفارشی و استفاده‌نشده)؛ دکمه‌ی حذف |
| ۱۳ | گزارش‌ها: دسته‌بندی | ایجاد/حذف با `assertEdit` (ناسازگار با ماتریس)؛ بدون ویرایش | create→`assertCreate`، delete→`assertDelete`، `PATCH` تغییر نام |
| ۱۴ | نقش‌ها (تنظیمات) | بدون تغییر نام | `PATCH roles/:id` (نقش سفارشی، ۲FA)؛ دکمه‌ی «تغییر نام» |
| ۱۵ | تست‌های جامع | هیچ تضمین خودکاری وجود نداشت | `route-guard.spec.ts`, `module-catalog-coverage.spec.ts`, `default-presets.spec.ts`, `crud-lifecycle.spec.ts` |

## ۶. باقی‌مانده‌ها (عمداً انجام نشد) و دلیل

| مورد | دلیل / تصمیم لازم |
|---|---|
| ویرایش چک، گواهی صادرشده، مرجوعی خرید/فروش، درخواست مرخصی ثبت‌شده | سند مالی/حقوقی یا گردش تأیید دارند؛ مسیر درست «لغو + ثبت مجدد» است. اگر مالک ویرایش پیش‌نویس این‌ها را هم می‌خواهد باید قاعده‌ی «فقط وضعیت اولیه» تصویب شود |
| ویرایش webhook (فقط ساخت/فعال‌سازی/حذف) | کم‌اهمیت؛ حذف و ساخت مجدد کافی است |
| حذف حرکت انبار / سند حسابداری | ممنوع طبق قوانین مالی؛ فقط ابطال |
| UI ویرایش یادداشت نمونه‌ی QC | بک‌اند (`PATCH samples/:id`) آماده است؛ UI فقط حذف نمونه/نتیجه را دارد |
| تغییر نام نقش و دسته‌بندی گزارش با `window.prompt` | کافی برای موجودیت تک‌فیلدی؛ در صورت نیاز مودال اختصاصی |
| پیش‌فرض‌های قالب‌های صنعتی (`prisma/control/seed.ts`) | چند نقش مدیریتی/سرپرست (مثلاً «سرپرست خط تولید»: warehouse) `FULL_ACCESS` (شامل حذف) دارند. این‌ها عمدی به‌نظر می‌رسند و **تغییر داده نشد** — تصمیم مالک لازم است |
| نقش «مدیر سیستم» برای ماژول‌های جدید (events، forms، mentoring، recruitment …) ردیف پیش‌فرض ندارد | مالک/مدیر عضویت به‌هرحال دسترسی کامل دارد؛ افزودن ردیف برای تننت‌های موجود تغییر رفتاری است و انجام نشد |
| تشخیص UI تقریبی است | بخش ۱ |

## ۷. چک‌لیست ماژول جدید (قاعده‌ی ثابت از این به بعد)

1. هر موجودیتِ قابل‌ثبت: `POST` (assertCreate)، `GET` لیست/جزئیات (assertView/ViewAll یا viewScope)، `PATCH` (assertEdit)، `DELETE` (assertDelete) — در صورت وابستگی: ۴۰۹ با پیام فارسی + مسیر `archive`/`restore`؛ برای سند مالی: `void`/`cancel`.
2. کد ماژول را به `PERMISSION_GATED_MODULE_CODES` (web `lib/api.ts`) اضافه کنید (تست parity و catalog coverage اجبار می‌کنند).
3. UI: `useModuleCan(code)` برای دکمه‌ها؛ حذف با `DeleteRecordButton` یا `MasterDeleteDialog` (نمایش تعداد استفاده + بایگانی).
4. پیش‌فرض نقش‌ها: حذف فقط برای «مدیر سیستم» (تست `default-presets.spec.ts`).
5. `npx vitest run src/permissions` باید سبز بماند.

## ۸. پیوست: ماتریس تولیدشده

(`node scripts/crud-audit.mjs` داده‌ی خام را چاپ می‌کند. فقط موجودیت‌های دارای مشاهده/ویرایش/حذف آمده‌اند؛ مسیرهای «اکشن» مثل `…/:id/approve` و ماژول‌های پلتفرمی/شخصی — auth، platform، messenger، notifications، dashboard، support — حذف شده‌اند. ستون «گارد مجوز» ✘ یعنی دست‌کم یک مسیر آن موجودیت کنترل ماژولی ندارد؛ مواردِ ✘ بررسی‌شده: GETهای تنظیمات عمومی خوانا برای همه‌ی کاربران، گزارش‌های حسابداری (کنترل در متد خصوصی `prepare` انجام می‌شود و اسکنر آن را نمی‌بیند)، و گاوصندوق محرمانه که پشت `VaultTicketGuard` و مالکیت است.)

### `accounting`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `accounting/accounts` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | accounting |
| `accounting/accounts/:id/ledger` | - | Y | - | - | · | Y | · | · | ✔ | accounting |
| `accounting/banking/banks` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | accounting |
| `accounting/banking/banks/:id/statement` | - | Y | - | - | · | NO | · | · | ✔ | accounting |
| `accounting/banking/banks/:id/balance` | - | Y | - | - | · | NO | · | · | ✔ | accounting |
| `accounting/banking/cash-boxes` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | accounting |
| `accounting/banking/cash-boxes/:id/statement` | - | Y | - | - | · | NO | · | · | ✔ | accounting |
| `accounting/banking/cash-boxes/:id/balance` | - | Y | - | - | · | NO | · | · | ✔ | accounting |
| `accounting/banking/transactions` | Y | Y | - | X | Y | Y | · | Y | ✔ | accounting |
| `accounting/banking/cheque-books` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | accounting |
| `accounting/banking/cheque-books/available-leaves` | - | Y | - | - | · | NO | · | · | ✔ | accounting |
| `accounting/budgets` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | accounting |
| `accounting/fixed-assets` | Y | Y | Y | X | Y | Y | Y | Y | ✔ | accounting |
| `accounting/entries` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | accounting |
| `accounting/parties/receivables` | - | Y | - | - | · | Y | · | · | ✔ | accounting |
| `accounting/parties/payables` | - | Y | - | - | · | Y | · | · | ✔ | accounting |
| `accounting/parties/:id/statement` | - | Y | - | - | · | Y | · | · | ✔ | accounting |
| `accounting/periods` | - | Y | - | - | · | NO | · | · | ✔ | accounting |
| `accounting/periods/settings` | - | - | Y | - | · | · | Y | · | ✔ | accounting |
| `accounting/reconciliation` | - | Y | - | - | · | Y | · | · | ✔ | accounting |
| `accounting/reconciliation/statement-lines` | - | - | - | Y | · | · | · | Y | ✔ | accounting |
| `accounting/reports/trial-balance` | - | Y | - | - | · | Y | · | · | ✘ | — |
| `accounting/reports/income-statement` | - | Y | - | - | · | Y | · | · | ✘ | — |
| `accounting/reports/balance-sheet` | - | Y | - | - | · | Y | · | · | ✔ | accounting |
| `accounting/reports/cash-movement` | - | Y | - | - | · | Y | · | · | ✘ | — |
| `accounting/reports/compare` | - | Y | - | - | · | NO | · | · | ✔ | accounting |
| `accounting/summary` | - | Y | - | - | · | Y | · | · | ✔ | accounting |

### `activity`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `activity` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `/activity/retention` | - | Y | Y | - | · | NO | NO | · | ✔ | — |

### `logs`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `logs/activity` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `logs/activity/modules` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `logs/activity/users` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `logs/activity/daily-summary` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `logs/daily-reports` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `logs/daily-reports/settings` | - | Y | Y | - | · | NO | Y | · | ✘ | — |
| `logs/errors` | - | Y | - | - | · | NO | · | · | ✔ | — |

### `users`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `/users/:id/activity` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `/users` | - | Y | Y | Y | · | Y | Y | NO | ✔ | — |
| `/users/offboarding-runs/:id/csv` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `/users/:id/offboarding-preview` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `/users/:id/permissions` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `/users/:id/management-role` | - | - | Y | - | · | · | Y | · | ✔ | — |

### `after-sales-service`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `after-sales-service/services` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `after-sales-service/services/:id/status` | - | - | Y | - | · | · | Y | · | ✔ | — |
| `after-sales-service/service-status-labels` | - | Y | - | - | · | NO | · | · | ✘ | — |
| `after-sales-service/reports` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `after-sales-service/settings/general` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `after-sales-service/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | — |

### `settings`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `settings/api-keys` | Y | Y | - | X | Y | Y | · | Y | ✔ | — |
| `settings/base-currency` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `settings/base-currency/conversions` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `settings/currencies` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |
| `settings/general` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `settings/general/stamp` | - | - | Y | - | · | · | Y | · | ✔ | — |
| `settings/webhooks/events` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `settings/webhooks` | Y | Y | - | Y | Y | Y | · | Y | ✔ | — |
| `settings/webhooks/:id/deliveries` | - | Y | - | - | · | Y | · | · | ✔ | — |

### `approvals`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `approvals` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `approvals/module-approvers` | - | Y | Y | - | · | Y | Y | · | ✘ | — |
| `approvals/pending-count` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `approvals/:id/detail` | - | Y | - | - | · | Y | · | · | ✔ | — |

### `attachments`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `attachments` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |

### `automation`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `automation/triggers` | - | Y | - | - | · | Y | · | · | ✔ | automation |
| `automation/rules` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | automation |

### `book-store`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `book-store/orders` | - | Y | - | - | · | Y | · | · | ✔ | book-store |
| `book-store/settings` | - | Y | Y | - | · | Y | Y | · | ✔ | book-store |

### `booking`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `booking/appointments/upcoming-this-week` | - | Y | - | - | · | Y | · | · | ✔ | booking |
| `booking/appointments/report` | - | Y | - | - | · | Y | · | · | ✔ | booking |
| `booking/appointments` | Y | Y | Y | Y | Y | NO | Y | Y | ✔ | booking |
| `booking/appointments/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | booking |
| `booking/service-types` | Y | Y | Y | X | Y | Y | Y | Y | ✔ | booking |
| `booking/my-availability` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `booking/time-blocks` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |
| `booking/time-blocks/auto-preview` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `booking/time-blocks/preferences` | - | - | Y | - | · | · | Y | · | ✔ | — |

### `certificates`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `certificates` | Y | Y | - | Y | Y | NO | · | Y | ✔ | certificates |
| `certificates/template-settings` | - | Y | Y | - | · | Y | Y | · | ✔ | certificates |
| `certificates/:id/image.png` | - | Y | - | - | · | NO | · | · | ✔ | certificates |
| `certificates/:id/pdf` | - | Y | - | - | · | NO | · | · | ✔ | certificates |

### `checks`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `checks` | Y | Y | - | X | Y | NO | · | Y | ✔ | sales |
| `checks/settings/reminder-channels` | - | Y | Y | - | · | Y | Y | · | ✘ | sales |
| `checks/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | sales |
| `checks/:id/reminder-days` | - | - | Y | - | · | · | Y | · | ✔ | sales |

### `signature-evidence`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `signature-evidence` | - | Y | - | - | · | Y | · | · | ✔ | — |

### `confidential-archive`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `confidential-archive/documents` | Y | Y | Y | Y | Y | Y | Y | Y | ✘ | — |
| `confidential-archive/my-access` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `confidential-archive/access` | - | Y | Y | Y | · | Y | Y | Y | ✔ | — |

### `contracts`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `contracts/templates` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | contracts |
| `contracts/expiring-soon` | - | Y | - | - | · | Y | · | · | ✔ | contracts |
| `contracts/categories` | - | Y | - | - | · | Y | · | · | ✔ | contracts |
| `contracts/company-signature` | - | Y | - | - | · | Y | · | · | ✔ | contracts |
| `contracts` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | contracts |
| `contracts/:id/pdf` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `contracts/:id/edit-requests` | - | Y | - | - | · | Y | · | · | ✔ | contracts |
| `contracts/:id/amendments` | Y | Y | - | - | Y | Y | · | · | ✔ | contracts |
| `contracts/:id/witnesses` | Y | Y | - | - | Y | Y | · | · | ✔ | contracts |
| `contracts/witnesses` | - | - | - | Y | · | · | · | Y | ✔ | contracts |

### `correspondence`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `correspondence/people` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `correspondence/me` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `correspondence/counters` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `correspondence/inbox` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `correspondence/reports/overdue` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `correspondence/signature-block` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `correspondence/signature-defaults` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `correspondence/letters` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |
| `correspondence/letters/register.csv` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `correspondence/letters/:id/revisions` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `correspondence/letters/:id/pdf` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `correspondence/letters/:id/slip` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `correspondence/letters/:id/evidence` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `correspondence/referrals` | - | - | - | X | · | · | · | - | ✔ | — |
| `correspondence/categories` | Y | Y | Y | Y | NO | Y | NO | Y | ✔ | — |
| `correspondence/numbering-schemes` | Y | Y | Y | Y | NO | Y | NO | Y | ✔ | — |
| `correspondence/archive-folders` | Y | Y | Y | Y | NO | Y | NO | Y | ✔ | — |
| `correspondence/letterheads` | Y | Y | Y | Y | NO | Y | Y | Y | ✔ | correspondence |
| `correspondence/letterheads/meta` | - | Y | - | - | · | Y | · | · | ✔ | correspondence |
| `correspondence/templates/placeholders` | - | Y | - | - | · | Y | · | · | ✔ | correspondence |
| `correspondence/templates` | Y | Y | Y | Y | NO | Y | Y | Y | ✔ | correspondence |

### `crm`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `crm/contacts` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | crm |
| `crm/contacts/search` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `crm/contacts/:id/statement` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `crm/contacts/:id/credit` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `crm/contacts/:id/supplier-risk` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `crm/contacts/:id/credit-inputs` | - | - | Y | - | · | · | Y | · | ✔ | crm |
| `crm/deals` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | crm |
| `crm/funnel/summary` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `crm/funnel/kpis` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `crm/funnel/stage-labels` | - | Y | Y | - | · | NO | NO | · | ✔ | crm |
| `crm/funnel/contacts` | - | Y | - | - | · | Y | · | · | ✔ | — |

### `daily-checklist`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `daily-checklist/subordinates` | - | Y | - | - | · | Y | · | · | ✔ | daily-checklist |
| `daily-checklist` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | daily-checklist |
| `daily-checklist/report` | - | Y | - | - | · | Y | · | · | ✔ | daily-checklist |

### `dispatch`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `dispatch/shipments` | Y | Y | - | - | NO | Y | · | · | ✔ | dispatch |
| `dispatch/shipments/active-counts` | - | Y | - | - | · | Y | · | · | ✔ | dispatch |
| `dispatch/source-status` | - | Y | - | - | · | Y | · | · | ✔ | dispatch |
| `dispatch/prefill` | - | Y | - | - | · | Y | · | · | ✔ | dispatch |
| `dispatch/production/:id/trigger` | - | - | Y | - | · | · | Y | · | ✔ | dispatch |
| `dispatch/settings` | - | Y | Y | - | · | Y | Y | · | ✔ | dispatch |
| `dispatch/lookups` | - | Y | - | - | · | NO | · | · | ✔ | dispatch |
| `dispatch/drivers` | - | Y | - | - | · | Y | · | · | ✔ | dispatch |
| `dispatch/doc-types` | Y | Y | Y | Y | NO | Y | Y | Y | ✔ | dispatch |
| `dispatch/rules` | Y | Y | Y | Y | NO | Y | Y | Y | ✔ | dispatch |
| `dispatch/shipments/:id/docs` | Y | - | - | Y | NO | · | · | Y | ✔ | — |

### `events`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `events` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | events |
| `events/ticket-types` | - | - | Y | X | · | · | Y | Y | ✔ | events |
| `events/:id/bookings` | Y | Y | - | - | NO | Y | · | · | ✔ | events |
| `events/:id/tickets` | - | Y | - | - | · | Y | · | · | ✔ | events |
| `events/tickets/by-contact` | - | Y | - | - | · | NO | · | · | ✔ | events |
| `events/tickets/:id/qr.png` | - | Y | - | - | · | NO | · | · | ✔ | events |
| `events/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | events |
| `events/:id/poster` | - | Y | - | - | · | NO | · | · | ✔ | events |

### `fleet`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `fleet/drivers` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | fleet |
| `fleet/drivers/:id/usage` | - | Y | - | - | · | Y | · | · | ✔ | fleet |
| `fleet/shipments` | Y | Y | Y | Y | Y | NO | Y | Y | ✔ | fleet |
| `fleet/shipments/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | fleet |
| `fleet/shipments/:id/usage` | - | Y | - | - | · | Y | · | · | ✔ | fleet |
| `fleet/shipments/:id/match-candidates` | - | Y | - | - | · | Y | · | · | ✔ | fleet |

### `forms`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `forms` | Y | Y | Y | X | Y | Y | Y | Y | ✔ | forms |
| `forms/inbox-summary` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `forms/:id/submissions` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `forms/:id/stats` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `forms/submissions/by-contact` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `forms/submissions` | - | Y | Y | - | · | Y | Y | · | ✔ | forms |

### `hr`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `hr/attendance` | Y | Y | - | Y | Y | NO | · | Y | ✔ | hr |
| `hr/departments` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | hr |
| `hr/employees` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | hr |
| `hr/employees/org-chart` | - | Y | - | - | · | Y | · | · | ✔ | hr |
| `hr/employees/:id/documents` | Y | - | - | Y | Y | · | · | Y | ✔ | hr |
| `hr/employees/:id/kpi` | - | Y | - | - | · | NO | · | · | ✔ | hr |
| `hr/leave` | Y | Y | - | Y | Y | Y | · | Y | ✔ | hr |
| `hr/payroll/settings/tax-insurance` | - | Y | Y | - | · | Y | Y | · | ✔ | hr |
| `hr/payroll` | - | Y | - | Y | · | Y | · | Y | ✔ | hr |
| `hr/payroll/:id/pdf` | - | Y | - | - | · | NO | · | · | ✔ | hr |
| `hr/rewards` | Y | Y | Y | Y | Y | NO | Y | Y | ✔ | hr |
| `hr/request-sms/settings` | - | Y | Y | - | · | Y | Y | · | ✔ | hr |
| `hr/summary` | - | Y | - | - | · | Y | · | · | ✔ | hr |

### `marketing`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `marketing/campaigns` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | marketing |
| `marketing/campaigns/:id/image` | - | Y | - | - | · | NO | · | · | ✔ | — |

### `mentoring`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `mentoring/engagements` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | mentoring |
| `mentoring/goals` | Y | - | Y | Y | Y | · | Y | Y | ✔ | mentoring |
| `mentoring/reports/overview` | - | Y | - | - | · | Y | · | · | ✔ | mentoring |
| `mentoring/reports/client-lifetime` | - | Y | - | - | · | Y | · | · | ✔ | mentoring |
| `mentoring/reports/by-advisor` | - | Y | - | - | · | Y | · | · | ✔ | mentoring |
| `mentoring/sessions/upcoming` | - | Y | - | - | · | NO | · | · | ✔ | mentoring |
| `mentoring/sessions` | Y | Y | Y | X | Y | NO | Y | Y | ✔ | mentoring |
| `mentoring/sessions/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | mentoring |
| `mentoring/sessions/:id/suggested-amount` | - | Y | - | - | · | Y | · | · | ✔ | mentoring |

### `health`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `health` | - | Y | - | - | · | NO | · | · | ✔ | — |

### `online-store`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `online-store/analytics/summary` | - | Y | - | - | · | Y | · | · | ✔ | online-store |
| `online-store/orders` | - | Y | - | - | · | NO | · | · | ✔ | online-store |
| `online-store/orders/:id/status` | - | - | Y | - | · | · | Y | · | ✔ | online-store |
| `online-store/products` | - | Y | - | - | · | Y | · | · | ✔ | online-store |
| `online-store/products/:id/listing` | - | - | Y | - | · | · | Y | · | ✔ | online-store |
| `online-store/reviews` | - | Y | - | - | · | Y | · | · | ✔ | online-store |
| `online-store/reviews/:id/status` | - | - | Y | - | · | · | Y | · | ✔ | online-store |

### `operations`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `operations/overview` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `operations/counters` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `operations/workload` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `operations/attention` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `operations/activity` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `operations/trend` | - | Y | - | - | · | NO | · | · | ✔ | — |

### `payment-gateway`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `payment-gateway/settings` | - | Y | Y | - | · | Y | Y | · | ✔ | — |

### `production`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `production/boms` | Y | Y | Y | Y | Y | NO | Y | Y | ✔ | production |
| `production/orders` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | production |
| `production/work-centers` | Y | Y | Y | Y | Y | NO | Y | Y | ✔ | production |

### `projects`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `projects/stage-templates` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | projects |
| `projects/sms-settings` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `projects` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | projects |
| `projects/:id/sms-notify` | - | - | Y | - | · | · | Y | · | ✔ | projects |
| `projects/:id/sms-preview` | - | Y | - | - | · | Y | · | · | ✔ | projects |
| `projects/:id/invoices` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `projects/:id/stages` | Y | - | Y | Y | Y | · | Y | Y | ✔ | projects |
| `projects/:id/public-link` | Y | Y | - | - | Y | Y | · | · | ✔ | projects |
| `projects/:id/notes` | Y | Y | - | Y | Y | Y | · | Y | ✔ | projects |
| `projects/:id/documents` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `projects/:id/proposals` | - | - | - | Y | · | · | · | Y | ✔ | projects |
| `projects/:id/sales-invoices` | - | - | - | Y | · | · | · | Y | ✔ | projects |

### `proposals`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `proposals/templates` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | proposals |
| `proposals` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | proposals |
| `proposals/:id/status-note` | - | - | Y | - | · | · | Y | · | ✔ | proposals |
| `proposals/:id/sms-preview` | - | Y | - | - | · | Y | · | · | ✔ | proposals |

### `purchasing`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `purchasing/orders` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | purchasing |
| `purchasing/orders/settings/approval-threshold` | - | Y | Y | - | · | Y | Y | · | ✘ | — |
| `purchasing/returns` | Y | Y | - | Y | Y | Y | · | Y | ✔ | purchasing |
| `purchasing/suppliers` | Y | Y | Y | Y | Y | NO | Y | Y | ✔ | purchasing |
| `purchasing/suppliers/search` | - | Y | - | - | · | NO | · | · | ✔ | purchasing |

### `qr-codes`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `qr-codes` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | qr-code |
| `qr-codes/:id/image.png` | - | Y | - | - | · | NO | · | · | ✔ | qr-code |

### `quality-control`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `quality-control/samples` | Y | Y | Y | Y | Y | NO | NO | Y | ✔ | quality-control |
| `quality-control/samples/:id/results` | Y | - | - | Y | Y | · | · | Y | ✔ | quality-control |
| `quality-control/test-types` | Y | Y | Y | Y | Y | NO | Y | Y | ✔ | quality-control |

### `ration-lab`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `ration-lab/discount-codes` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | ration-lab |
| `ration-lab/discount-codes/:id/deactivate` | - | - | Y | - | · | · | Y | · | ✔ | ration-lab |
| `ration-lab/discount-codes/:id/activate` | - | - | Y | - | · | · | Y | · | ✔ | ration-lab |
| `ration-lab/followups/due` | - | Y | - | - | · | NO | · | · | ✔ | ration-lab |
| `ration-lab/followups/:id/complete` | - | - | Y | - | · | · | Y | · | ✔ | ration-lab |
| `ration-lab/reviewers` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | ration-lab |
| `ration-lab/reports/sample/:id/trend` | - | Y | - | - | · | Y | · | · | ✔ | ration-lab |
| `ration-lab/reports/aggregate` | - | Y | - | - | · | Y | · | · | ✔ | ration-lab |
| `ration-lab/samples` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | ration-lab |
| `ration-lab/samples/:id/pdf` | - | Y | - | - | · | NO | · | · | ✔ | ration-lab |

### `recruitment`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `recruitment/postings` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |
| `recruitment/postings/:id/report` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `recruitment/applicants` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |
| `recruitment/interviews` | Y | Y | Y | X | Y | NO | Y | Y | ✔ | — |
| `recruitment/applicants/:id/offer` | Y | Y | - | - | Y | NO | · | · | ✔ | — |
| `recruitment/offers/:id/pdf` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `recruitment/settings/general` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `recruitment/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `recruitment/settings/company-seal` | - | Y | - | - | · | NO | · | · | ✔ | — |

### `referral-marketing`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `referral-marketing/me` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `referral-marketing/me/settlements` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `referral-marketing/me/balance` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `referral-marketing/me/conversions` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `referral-marketing/me/commissions` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `referral-marketing/me/support-tickets` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `referral-marketing/resellers` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | referral-marketing |
| `referral-marketing/resellers/dashboard` | - | Y | - | - | · | Y | · | · | ✔ | referral-marketing |
| `referral-marketing/resellers/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | referral-marketing |
| `referral-marketing/resellers/:id/balance` | - | Y | - | - | · | NO | · | · | ✔ | referral-marketing |
| `referral-marketing/resellers/:id/settlements` | Y | Y | - | - | Y | Y | · | · | ✔ | referral-marketing |
| `referral-marketing/resellers/:id/conversions` | Y | Y | - | - | Y | Y | · | · | ✔ | referral-marketing |
| `referral-marketing/resellers/:id/commissions` | - | Y | - | - | · | Y | · | · | ✔ | referral-marketing |

### `referrals`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `referrals` | Y | - | - | X | Y | · | · | - | ✔ | — |
| `referrals/inbox` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `referrals/counts` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `referrals/mine-ids` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `referrals/assignees` | - | Y | - | - | · | NO | · | · | ✔ | — |

### `reports`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `reports/categories` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | reports |
| `reports` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | reports |

### `sales`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `sales/invoices` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | sales |
| `sales/invoices/settings/delivery-sms-template` | - | Y | Y | - | · | Y | Y | · | ✘ | — |
| `sales/invoices/settings/default-bank-info` | - | Y | Y | - | · | Y | NO | · | ✘ | — |
| `sales/invoices/settings/payment-reminder-days` | - | Y | Y | - | · | Y | Y | · | ✘ | — |
| `sales/invoices/settings/signature-policy` | - | Y | Y | - | · | Y | Y | · | ✘ | — |
| `sales/invoices/:id/revise` | - | - | Y | - | · | · | Y | · | ✔ | sales |
| `sales/invoices/:id/revisions` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `sales/invoices/:id/signing` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `sales/invoices/:id/pdf` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `sales/quotations` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | sales |
| `sales/quotations/:id/revisions` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `sales/recurring-invoices` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | sales |
| `sales/accounting-backfill/report` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `sales/returns` | Y | Y | - | Y | Y | Y | · | Y | ✔ | sales |
| `sales/returns/invoice/:id/returnable` | - | Y | - | - | · | Y | · | · | ✔ | sales |

### `scheduling`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `scheduling/jobs` | - | Y | Y | - | · | Y | Y | · | ✔ | — |

### `tasks`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `tasks` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |
| `tasks/summary` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `tasks/settings` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `tasks/:id/checklist` | Y | - | Y | Y | Y | · | Y | Y | ✔ | — |

### `tax`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `tax/settings` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `tax/status` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `tax/settings/key` | - | - | Y | Y | · | · | Y | Y | ✔ | — |
| `tax/product-codes` | - | Y | Y | Y | · | NO | Y | Y | ✔ | tax |
| `tax/invoices` | Y | Y | Y | X | Y | Y | Y | - | ✔ | tax |

### `roles`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `/roles` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | — |
| `/roles/:id/permissions` | - | - | Y | - | · | · | Y | · | ✔ | — |

### `voip`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `voip/navatel/cdr` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `voip/navatel/stats` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `voip/navatel/missed` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `voip/navatel/voicemails` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `voip/navatel/voicemails/:id/messages` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `voip/navatel/audio` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `voip/providers` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `voip/status` | - | Y | - | - | · | Y | · | · | ✔ | — |
| `voip/config` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `voip/extensions` | - | Y | - | - | · | NO | · | · | ✔ | — |
| `voip/extensions/me` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `voip/calls` | - | Y | - | - | · | NO | · | · | ✔ | — |

### `warehouse`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `warehouse/settings/costing-method` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `warehouse/movements` | Y | Y | Y | X | Y | Y | Y | Y | ✔ | warehouse |
| `warehouse/products` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | warehouse |
| `warehouse/settings/auto-sale-price` | - | Y | Y | - | · | Y | Y | · | ✔ | — |
| `warehouse/stock-import/batches` | - | Y | - | X | · | Y | · | Y | ✔ | warehouse |
| `warehouse/summary` | - | Y | - | - | · | Y | · | · | ✔ | warehouse |
| `warehouse/warehouses` | Y | Y | Y | Y | Y | Y | Y | Y | ✔ | warehouse |

### `warranty`

| موجودیت (مسیر) | C | R | U | D/بایگانی/ابطال | UI: C | R | U | D | گارد مجوز | ماژول ماتریس |
|---|---|---|---|---|---|---|---|---|---|---|
| `warranty/codes` | - | Y | - | X | · | Y | · | Y | ✔ | warranty |
| `warranty/codes/invoice-groups` | - | Y | - | - | · | NO | · | · | ✔ | warranty |
| `warranty/invoices/search` | - | Y | - | - | · | NO | · | · | ✔ | warranty |
| `warranty/invoices/:id/summary` | - | Y | - | - | · | NO | · | · | ✔ | warranty |
| `warranty/products` | - | Y | Y | - | · | Y | Y | · | ✔ | warranty |
| `warranty/invoices/:id/has-issuable-warranty` | - | Y | - | - | · | Y | · | · | ✔ | warranty |
| `warranty/reports` | - | Y | - | - | · | Y | · | · | ✔ | warranty |
| `warranty/settings/general` | - | Y | Y | - | · | Y | Y | · | ✔ | warranty |
| `warranty/settings/sms` | - | Y | Y | - | · | Y | Y | · | ✔ | warranty |