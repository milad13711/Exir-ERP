# ممیزی دامنه‌ی دسترسی («مشاهده‌ی همه» / «فقط خودم») — 2026-10

Backend: `apps/backend-core/src` (159 کنترلر). وضعیت: **OK** = قبلاً درست بود، **FIXED** = در این کار اصلاح شد، **NEEDS-DECISION** = نیاز به تصمیم مالک.

## ریشه‌ی مشکلات گزارش‌شده

1. **گزارش‌ها**: لیست/جزئیات با `assertViewAll` محافظت می‌شد و هیچ فیلتر نویسنده‌ای نداشت. پس (الف) هر کس «مشاهده‌ی همه» داشت *همه‌ی* گزارش‌ها از جمله گزارش مدیر را می‌دید؛ (ب) «فقط خودم» اصلاً به ماژول دسترسی نمی‌داد، بنابراین مالک ناچار بود برای نوشتن گزارش به کارمند «مشاهده‌ی همه» بدهد → کارمند گزارش مدیر را می‌دید. پیوست‌ها هم همین‌طور (`VIEW_ALL_ONLY.Report`).
2. **کاربر بدون شناسه‌ی تننت (کلید API غیرمدیر)**: `viewScope`, `projectScope`, `contractScope` فیلتر `{owner: null}` می‌ساختند که با رکوردهای بی‌صاحب یکی می‌شد. اکنون ۴۰۳.
3. **داشبورد (`GET /dashboard/summary`)**: جمع‌های کل شرکت (موجودی نقد، فاکتور معوق، چک، انبار، روند فروش) برای «فقط خودم» هم پر می‌شد (`canViewAll || canViewOwn`). اکنون فقط «مشاهده‌ی همه».
4. **داشبورد: پیگیری/پیامک یادآوری فاکتور** (`overdue-invoices/:id/*`): فقط `assertView('sales')`، بدون بررسی مالکیتِ فاکتور → هر کاربر «فقط خودم» روی فاکتور دیگران عمل می‌کرد. اکنون `viewScope+assertInScope`.
5. **ماتریس UI**: تیک «مشاهده‌ی همه» بدون «مشاهده‌ی خودم» ذخیره می‌شد و متن راهنما «خودم» را نادرست/ناقص توضیح می‌داد؛ `reports` در `OWN_SCOPED_MODULES` نبود. اصلاح شد.
6. **Seed پیش‌فرض**: نقش «کارشناس فروش» روی `crm` و `sales` «مشاهده‌ی همه» داشت (کل مشتریان/فاکتورهای شرکت). اکنون «فقط خودم» (فقط تننت‌های جدید).
7. **پروژه‌ها**: منطق دامنه (مدیر/سازنده/عضو/مسئول مرحله) در *همه‌ی* روت‌های `/projects` (۴۶ روت، زیرمنابع یادداشت/اسناد/فاکتور/پیامک/لینک عمومی/پیوست مرحله) و در پیوست‌ها اعمال می‌شد (OK). نشت واقعیِ قابل‌اثبات در کد پروژه فقط مورد ۲ (کاربر بدون id) بود. علت محتمل «همه پروژه‌ها را می‌بینند» در تننت واقعی: نقش‌هایی که `projects.canViewAll` دارند (مثلاً تیک ستون/ردیف «همه» در مودال، یا نقش «مدیر سیستم» که `projects: FULL_ACCESS` دارد و به کارمندان داده شده) — در DB ماتریس نقش‌ها را بررسی کنید (دسترسی به DB خارج از اختیار این کار بود). رفتار union: یک نقش با viewAll کافی است؛ دسترسی دستی کاربر جایگزین union می‌شود.

## قاعده‌ی سلسله‌مراتب گزارش‌ها (`reports/report-scope.ts`)

| دسترسی | چه گزارش‌هایی دیده می‌شود |
|---|---|
| OWNER/ADMIN | همه |
| «فقط خودم» | نوشته‌ی خود + ارجاع‌شده به خود + «دانش سازمانی» |
| «مشاهده‌ی همه» | همان‌ها + گزارش *زیردستان* (همه‌ی سطوح `Employee.managerId` + اعضای واحدی که مدیرش است، با حذف هر بالادست) + گزارش بی‌صاحب |
| هیچ‌کدام / کلید API غیرمدیر | ۴۰۳ |

- بالادست، هم‌سطح و شاخه‌ی نامرتبط هرگز دیده نمی‌شوند. کاربری که به `Employee` وصل نیست زیردست ندارد (فقط خودش).
- ویرایش/حذف/بایگانی/ارجاع/تبدیل به دانش: فقط نویسنده یا مدیر بالادست او (گیرنده یا گزارش دانش‌سازمانی به‌تنهایی اجازه‌ی تغییر نمی‌دهد). پاراف: فقط گیرنده‌ی همان ارجاع (یا مدیر).
- اعمال‌شده در: لیست، جزئیات، تمام عملیات `:id`، پیوست‌ها (`AttachmentAccessService`)، گزارش روزانه‌ی چک‌لیست (نویسنده = صاحب چک‌لیست). گزارش‌ها نظر/خروجی/آمار جداگانه ندارند.
- migration لازم نبود (`Report.createdByUserId` و `Employee.userId/managerId` موجودند).

## جدول ممیزی

| ماژول | گروه endpoint | مکانیزم | وضعیت |
|---|---|---|---|
| reports | لیست/جزئیات/mutation/refer/paraph/پیوست | `reportScope`/`reportEditScope` | FIXED |
| reports | categories | `assertView` (داده‌ی مشترک؛ حذف: edit+viewAll) | OK |
| projects | CRUD، وضعیت، مراحل، تأیید/رد، SMS، لینک عمومی، یادداشت، اسناد، فاکتورهای پروژه، پیوست | `projectScope` + `assertInScope` در همه | OK |
| projects | `projectScope` با کاربر بدون id | ۴۰۳ | FIXED |
| projects | `stage-templates` | assertView/Create/Edit (داده‌ی مشترک) | OK |
| projects | `GET :id/invoices` | دامنه‌ی پروژه (نه دامنه‌ی فروش) | NEEDS-DECISION |
| projects | public link `/public/projects/*` | توکن | OK |
| dashboard | summary | فقط viewAll | FIXED |
| dashboard | remind-sms / follow-up(s) فاکتور | `viewScope`+`assertInScope` | FIXED |
| dashboard | calendar | scope all/own/none به‌ازای نوع رویداد | OK (کار تقویم/یادآور در دست عامل دیگر) |
| permissions | `viewScope`/`contractScope` null-user | ۴۰۳ | FIXED |
| tasks, operations | `taskScopeWhere` (guard نبود id → هیچ) | OK |
| crm contacts/deals/funnel/voip calls | `viewScope(ownerUserId)` + `assertContactInScope`/`assertDealInScope` | OK |
| sales invoices/quotations/returns/recurring | `viewScope(createdByUserId)`/`assertInvoiceInScope`/viewAll | OK |
| purchasing orders/returns | viewScope؛ approve/reject → `assertApprover` در سرویس | OK |
| purchasing suppliers, warehouse products/warehouses, production boms/work-centers, accounting accounts, fleet drivers, ration-lab discount/reviewers, quality test-types, booking service-types, recruitment/… settings | `assertView` (داده‌ی مشترک/تنظیمات) | NEEDS-DECISION (فهرست تأمین‌کنندگان/رانندگان/کدهای تخفیف برای «فقط خودم» هم باز است؛ برای انتخاب‌گرهای فرم لازم است) |
| accounting journal | viewScope؛ بقیه (ledger, budgets, assets, party-ledger, reconciliation, reports, summary) | viewAll | OK |
| contracts, proposals, tax, checks, forms, marketing campaigns | scope اختصاصی (`contractScope`, `proposalScope`, `taxInvoiceScope`, `form-scope`, checks) | OK |
| hr | employees: viewAll یا زنجیره‌ی مدیریتی (`getVisibleEmployeeIds`)؛ leave approve با `isInManagerChain`؛ payroll/KPI/attendance/personnel/summary viewAll | OK |
| hr | `GET payroll/settings/tax-insurance` | بدون مجوز ماژول (نرخ‌های عمومی مالیات) | NEEDS-DECISION |
| mentoring, events, booking appointments, certificates, after-sales, online-store, quality samples, production orders, fleet shipments, qr-code, recurring | `assertViewAll` برای داده‌ی رکوردی | OK |
| warranty, ration-lab samples/followups/reports, recruitment | viewAll برای رکوردها؛ settings با assertView | OK |
| dispatch | `dispatchViewWhere` (id=null → ۴۰۳) + مسئول وظیفه | OK |
| approvals | کارتابل: assigneeUserId=me (غیرمدیر) | OK |
| attachments | `AttachmentAccessService` (OWNED، project، report…؛ ناشناخته = مدیر) | OK / Report FIXED |
| activity/logs | مدیر یا viewAll؛ غیر آن فقط خود (guard `__none__`) | OK |
| daily-checklist | خود + زیردستان (`listSubordinates`) | OK |
| messenger, notifications, workspace, onboarding, support, api-keys, webhooks, settings/*, admin/*, platform-management, backup | عضویت/مالک/`RolesGuard`/`AdminJwtAuthGuard` | OK |
| confidential-archive | OTP + ACL داخلی ماژول | OK (بازبینی سطحی) |
| public/* و ration-lab/public | توکن/OTP، بدون نشست | OK (بازبینی سطحی) |

محدودیت ممیزی: برای ~۱۳۰ کنترلر نگاشت مکانیزم از روی کد کنترلر/سرویس‌های دامنه انجام شد؛ منطق تک‌تک کوئری‌های سرویس‌های داخلی (cron، گزارش‌های تجمیعی) خط‌به‌خط بازبینی نشد.

## موارد نیازمند تصمیم مالک

1. گزارش‌های «دانش سازمانی» برای هر کاربرِ دارای دسترسی مشاهده دیده می‌شوند (تبدیل عمدی). اگر باید محدودتر باشد اعلام کنید.
2. کاربر «مشاهده‌ی همه» بدون پرونده‌ی پرسنلی متصل (Employee.userId) فقط گزارش خودش را می‌بیند؛ برای فعال‌شدن سلسله‌مراتب باید در منابع انسانی کاربران به پرونده و مدیر مستقیم وصل شوند.
3. گزارش بی‌صاحب (سیستمی/کلید API) برای دارندگان «مشاهده‌ی همه» دیده می‌شود.
4. `assertView` روی فهرست تأمین‌کنندگان، رانندگان، کدهای تخفیف آزمایشگاه جیره، انبار/کالا (داده‌ی مشترک).
5. فاکتورهای متصل به پروژه برای عضو پروژه بدون دسترسی فروش.
6. قالب‌های صنف در `prisma/control/seed.ts` (EDITOR_ACCESS با viewAll برای فروش/…) و Seed تننت‌های موجود تغییر نکرد؛ نقش‌های فعلی تننت‌ها را از «تنظیمات → نقش‌ها» مرور کنید.
