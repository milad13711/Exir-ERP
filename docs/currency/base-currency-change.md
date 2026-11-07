# تغییر ارز پایه (ریال ⇄ تومان ⇄ ...) — موجودی، طراحی، ریسک‌ها

وضعیت: پیاده‌سازی شده (بک‌اند + UI)، **هنوز روی هیچ دیتابیس واقعی اجرا نشده**. کد اصلی: `apps/backend-core/src/base-currency/`.

## ۱. موجودی: پول امروز چطور ذخیره و نمایش داده می‌شود

### ذخیره
* همه‌ی مبالغ **عدد صحیح بدون واحد ذخیره‌شده‌اند** و واحدشان «تومان» است (کامنت اسکیما: `// تومان`). هیچ ستون «ارز» کنار مبلغ نیست؛ تنها استثناء `accounting_bank_accounts.currency` (پیش‌فرض `IRT`) که فقط یک برچسب است.
* دو نوع ستون: `Int` (INT4، سقف **۲٬۱۴۷٬۴۸۳٬۶۴۷**) و `BigInt` (دفتر کل، مانده‌ی بانک، معامله‌ها، ارزش واردات انبار). پاسخ JSON مقدارهای BigInt را به `number` تبدیل می‌کند (`main.ts`)، یعنی سقف عملی `2^53-1`.
* ماژول ارزها: جدول `currencies.rate` (DECIMAL(18,4)) = «چند تومان به‌ازای ۱ واحد ارز خارجی»؛ کالاهای ارزی `costPriceFx/salePriceFx` (مبلغ خارجی، مستقل از ارز پایه) و روی ردیف فاکتور/پیش‌فاکتور/سفارش خرید `exchangeRateFx` (قفل نرخ زمان صدور). `costPrice/salePrice` کالای ارزی آخرین معادل محاسبه‌شده‌ی تومانی است.
* ارز پایه تا امروز **ضمنی** بود (ردیفی در `currencies` ندارد).

### فهرست ستون‌های مبلغی (منبع واحد: `money-columns.ts`، تطبیق خودکار با اسکیما در `money-columns.spec.ts`)
| گروه | جدول: ستون‌ها |
|---|---|
| فروش | `sales_invoices`: subtotal, discount, taxAmount, total, paidAmount · `sales_invoice_lines`: unitPrice, lineTotal · `sales_quotations`: subtotal, discount, total · `sales_quotation_lines`: unitPrice, lineTotal · `sales_returns`: subtotal, total · `sales_return_lines`: unitPrice, lineTotal · `sales_recurring_invoice_templates`: discount · `sales_recurring_invoice_lines`: unitPrice · `sales_payments`: amount · `dispatch_invoice_adjustments`: old/new Subtotal, Discount, TaxAmount, Total |
| خرید | `purchase_orders`: subtotal, total, paidAmount · `purchase_order_lines`: unitCost, lineTotal · `purchase_returns`: subtotal, total · `purchase_return_lines`: unitCost, lineTotal · `purchase_payments`: amount |
| چک و طرف‌حساب | `checks`: amount · `party_transactions`: amount |
| حسابداری | `accounting_journal_lines`: debit, credit (BigInt) · `accounting_bank_statement_lines`: amount · `accounting_budget_lines`: amount · `accounting_fixed_assets`: purchaseCost, salvageValue, disposalAmount, postedDepreciation · `accounting_bank_accounts`/`accounting_cash_boxes`: openingBalance · `accounting_bank_transactions`: amount |
| انبار | `warehouse_products`: costPrice, salePrice, publicCompareAtPrice · `warehouse_stock_movements`: unitCost · `warehouse_stock_import_batches`: totalValue |
| منابع انسانی/استخدام | `hr_employees`: baseSalary · `hr_payroll_slips`: baseSalary, allowances, deductions, insuranceAmount, taxAmount · `hr_personnel_rewards/penalties`: amount · `recruitment_job_postings`: publishBudget · `recruitment_offers`: salary |
| CRM | `crm_contacts`: acquisitionCost, bankAvgMonthlyTurnover, creditLimitOverride · `crm_purchase_events`: amount · `crm_deals`: value |
| قرارداد/پروژه/پیشنهاد | `contracts`: value · `projects`: budget · `proposals`/`proposal_templates`: amount |
| سایر ماژول‌ها | `mentoring_engagements`: hourlyRate, packagePrice, subscriptionMonthlyPrice · `service_types`: price, depositAmount · `appointments`: depositAmount · `store_orders`: subtotal · `store_order_lines`: unitPrice, lineTotal · `book_orders`: unitPrice · `event_ticket_types`: price · `event_bookings`: unitPrice, totalAmount · `marketing_campaigns`: attributedRevenue · `reseller_settlements`: totalCommission, paidCommission, amountDue · `referral_commissions`: amount · `ration_samples`: analysisFeeAmount, finalFeeAmount · `ration_formula_lines`: unitCostSnapshot, lineCost |
| نرخ‌ها (DECIMAL، با همان ضریب) | `currencies.rate`, `sales_invoice_lines/sales_quotation_lines/purchase_order_lines.exchangeRateFx` |
| JSON آرایه‌ای (فیلدهای مبلغی هر عنصر؛ `json-money.ts`) | `proposals.invoiceLines[].unitPrice` · `reseller_settlements.lines[].amount/paid/due` · `dispatch_invoice_adjustments.lineChanges[].unitPrice/oldTotal/newTotal` (تعدیل‌های در انتظار بدون این تبدیل در `applyLines` رد می‌شدند) — با لاگ گرد‌کردن و بازیابی دقیق در بازگشت |
| تنظیمات JSON | `module_settings`: `purchasing/approvalThreshold`, `book-store/settings` (قیمت‌ها), `payroll/taxInsuranceRates.taxExemptionMonthly` |

### نمایش/چاپ
* وب‌پنل: `formatToman()` در `lib/persian.ts` + حدود ۹۰ برچسب «(تومان)» ثابت در فرم‌ها/کارت‌ها (۴۹ فایل).
* بک‌اند: `formatToman()` در `common/persian.ts` (PDF فاکتور، قرارداد، فیش حقوق، پیشنهاد استخدام، گزارش جیره)، پیامک‌ها/نوتیف‌ها (یادآور فاکتور، چک، وضعیت حساب، کارتابل تأیید)، خروجی MCP، فید گوگل/متا (`IRR` = تومان×۱۰)، قالب اکسل ورود موجودی («بهای واحد (تومان)»)، صفحه‌های عمومی (فروشگاه، رویداد، رزرو، فاکتور، پیشنهاد...).
* مرزهای واحد (جایی که تومان به‌طور ضمنی ریال/تومان می‌شود): درگاه پرداخت (زرین‌پال/بیت‌پی ×۱۰ در provider)، سامانه مودیان (`TOMAN_TO_RIAL = 10` در mapper)، به‌روزرسانی خودکار نرخ ارز (tgju ریال ÷۱۰)، آستانه‌های امتیازدهی اعتباری (CRM) که بر پایه‌ی تومان نوشته شده‌اند.
* **پلتفرم اکسیر** (صورتحساب اشتراک، فروشگاه ماژول، بسته‌ی پیامک، `billing`/`platform`) پول **خود اکسیر** است و همیشه تومان می‌ماند — با ارز پایه‌ی تننت کاری ندارد (`formatToman` ثابت بدون تغییر).

## ۲. طراحی انتخاب‌شده

**بازمقیاس‌سازی واقعی مبالغ ذخیره‌شده با ضریب دقیق + تنظیم «ارز پایه» در `module_settings` (`currency-exchange/baseCurrency`)**. «فقط تغییر برچسب نمایش» رد شد چون خواسته‌ی مالک تغییر واقعی قیمت/فاکتور است و تنها‌برچسب، ارقام را اشتباه نشان می‌داد.

* **ضریب** = کسر صحیح BigInt (`rateNum/rateDen`)؛ تومان→ریال ۱۰/۱، ریال→تومان ۱/۱۰ (برای این جفت فقط همین ضریب پذیرفته می‌شود). ارز دلخواه با ضریب صریح (مثلاً `0.000024`) هم ممکن است ولی توصیه نمی‌شود (اعشار از دست می‌رود، درگاه/مودیان کار نمی‌کند).
* **اجرا در یک تراکنش دیتابیس** (همه یا هیچ): `LOCK TABLE … SHARE ROW EXCLUSIVE` روی همه‌ی جدول‌های مبلغی، `UPDATE` ستون‌به‌ستون با `numeric` (بدون float)، تأیید جمع قبل/بعد، تأیید تراز، ثبت تنظیم و رکورد عملیات — اگر هر مرحله شکست بخورد کل تراکنش برمی‌گردد و داده دست‌نخورده می‌ماند. «Resumable» یعنی همین: هیچ حالت نیمه‌کاره‌ای وجود ندارد؛ عملیات RUNNING با ضربان قطع‌شده (کرش پروسه) `FAILED` علامت می‌خورد و دوباره قابل اجراست. شناسه‌ی `idempotencyKey` اجرای تکراری را به همان رکورد برمی‌گرداند.
* **پیش‌نمایش/dry-run** (`POST …/preview`، فقط‌خواندنی): تعداد ردیف، جمع قبل و جمع مورد انتظار بعد هر ستون، نمونه‌ی بزرگ‌ترین مقدارها (قبل→بعد)، تعداد خانه‌های نامضرب، سرریز، وضعیت تراز دفتر کل، موانع (blocking) و هشدارها.
* **قاعده‌ی گرد‌کردن**: `STRICT` (پیش‌فرض) — اگر یک مبلغ هم دقیق تبدیل نشود، عملیات رد می‌شود. `ROUND` — نیم به سمت دور از صفر (متقارن برای منفی)، هر خانه‌ی گردشده در `base_currency_rounding_log` (مقدار قدیم/جدید) ثبت می‌شود و مجموع اختلاف در گزارش می‌آید. نرخ‌های DECIMAL همیشه به ۴ رقم گرد می‌شوند (هشدار، نه مانع).
* **دفتر کل**: اگر تبدیل ROUND باعث نامتراز شدن سندی شود که پیش از تبدیل تراز بوده، سطرِ بزرگ‌ترینِ سمتِ سنگین‌تر به اندازه‌ی اختلاف تعدیل می‌شود (ثبت در لاگ با `kind=LEDGER_ADJUST`)؛ در `STRICT` اصلاً چنین چیزی رخ نمی‌دهد و اگر رخ دهد تراکنش لغو می‌شود. پس از تبدیل: جمع کل بدهکار = بستانکار و تعداد اسناد نامتراز نباید بیشتر شده باشد، وگرنه رول‌بک. اسنادی که از قبل نامتراز بوده‌اند فقط هشدار می‌گیرند. «پیش از ثبت سند اختلافی» ایجاد نمی‌شود — سند تعدیلی جدید نمی‌سازیم، چون عدد خود سطرها دقیقاً قابل ردیابی و برگشت است.
* **ماه‌های بسته‌ی حسابداری**: همه‌ی ماه‌ها (باز و بسته) برای یکدستی دفتر کل تبدیل می‌شوند؛ تبدیل با SQL خام انجام می‌شود، پس `assertPeriodOpen` دور زده می‌شود (عمدی)؛ قفل ماه‌ها (`accounting_period_locks`) مبلغی ندارد و دست نمی‌خورد.
* **قفل نوشتن (فقط همان تننت)**: حین اجرا، `BaseCurrencyWriteLockInterceptor` نوشتن‌های مالی همان تننت (فروش، خرید، حسابداری، چک، انبار، HR، CRM، قرارداد، فروشگاه، رویداد، رزرو، مودیان، sync، MCP، تأییدها) را با ۴۲۳ رد می‌کند. برای `/public/*` تننت از `:slug` مسیر شناخته می‌شود و فقط همان اسلاگ قفل است؛ اگر اسلاگ قابل تشخیص نباشد **مسدود نمی‌شود**. علاوه بر آن `LOCK TABLE` دیتابیسی و ایندکس یکتای جزئی «فقط یک RUNNING».
* **تخلیه (drain)**: پس از قفل‌کردن، سرویس تا ۳۰ ثانیه (`BASE_CURRENCY_DRAIN_MS`) منتظر می‌ماند تا درخواست‌های مالیِ در جریانِ همان تننت (شمارنده‌ی in-flight در interceptor) تمام شوند؛ اگر نشد، عملیات شروع نمی‌شود (۴۰۹، رکورد FAILED، هیچ تغییری).
* **کرون‌ها و صف‌ها**: `isConversionActive()` (حافظه + ردیف RUNNING با ضربان تازه در DB) پیش از کار روی هر تننت چک می‌شود در: فاکتور تکرارشونده، یادآور فاکتور، یادآور چک، یادآور قرارداد، worker مودیان، کرون dispatch، به‌روزرسانی نرخ ارز. ساخت/تأیید پرداخت درگاه (شامل بازگشت GET درگاه) هنگام تبدیل ۴۲۳ با پیام فارسی می‌دهد (پرداخت در درگاه از بین نمی‌رود؛ بعداً تأیید می‌شود). کرون‌هایی که مبلغ نمی‌خوانند/نمی‌نویسند (وظایف، پیام‌رسان، تولد...) دست نخورده‌اند.
* **ترتیب اجرا**: پیش‌بررسی + عبارت + بررسی (بدون مصرف) کد → ردیف RUNNING (قفل) → تخلیه → **پشتیبان** → مصرف کد → تراکنش. تلاش مجدد با همان `idempotencyKey` همان ردیف را برمی‌گرداند (پشتیبان دوم گرفته نمی‌شود). اگر پشتیبان یا تخلیه شکست بخورد، ردیف FAILED می‌شود، قفل آزاد می‌شود و **کد پیامکی مصرف‌نشده و معتبر می‌ماند**.
* **پشتیبان اجباری**: `BackupDrService.backupTenantForOperation` (pg_dump، فشرده/رمزنگاری‌شده) در پوشه‌ی جداگانه‌ی `<slug>__preconv-<زمان>`؛ پس نه پشتیبان شبانه را بازنویسی می‌کند نه عملیات قبلی/بازگشت را، و هرس شبانه به آن دست نمی‌زند (پاک‌سازی دستی). نام فایل، حجم و `sha256` (از manifest) روی رکورد عملیات ثبت می‌شود. ناموفق ⇒ ۵۰۲ و هیچ تغییری. فقط در `NODE_ENV!=production` با `BASE_CURRENCY_SKIP_BACKUP=true` قابل رد شدن است.
* **رکورد عملیات** `base_currency_conversions`: از/به، ضریب، حالت گرد‌کردن، اجراکننده، زمان‌ها، فایل پشتیبان، خطا، و `report` (تعداد ردیف + جمع قبل/بعد هر ستون، مجموع اختلاف گرد‌کردن، تراز قبل/بعد، تعداد تعدیل تراز، بررسی هویت فاکتور).
* **بازگشت (reverse)**: فقط آخرین عملیات `DONE`، تا زمانی که عملیات دیگری پس از آن نباشد. بازگشت = تبدیل با ضریب معکوس + بازیابی دقیق خانه‌های گردشده/تعدیل‌شده از لاگ (فقط اگر مقدار فعلی همان مقدار ثبت‌شده‌ی بعد از تبدیل باشد، یعنی کسی ویرایشش نکرده). داده‌ی جدیدی که پس از تبدیل ثبت شده فقط با ضریب معکوس مقیاس می‌شود (برای نامضرب‌ها `ROUND` لازم است).
* **مجوز**: `JwtAuthGuard + ModuleGuard('currency-exchange') + RolesGuard(OWNER) + @HumanOnly` (کلید API ممنوع)؛ داخل سرویس هم دوباره مالک/نشست انسانی چک می‌شود. تأیید دومرحله‌ای: عبارت تایپی («تغییر ارز پایه به ریال») + کد پیامکی ۶ رقمی به شماره‌ی خود مالک (۵ دقیقه، حداکثر ۳ درخواست در ۱۵ دقیقه). شمارش تلاش اتمیک است (`UPDATE … WHERE attempts < 5` پیش از مقایسه، پس درخواست‌های موازی سقف را دور نمی‌زنند) و کد به «طرح» (هش از/به/ضریب/حالت/نوع) بسته است؛ کد یک طرح برای طرح دیگر پذیرفته نمی‌شود، کد جدید کدهای قبلی را باطل می‌کند، مصرف اتمیک و فقط پس از موفقیت پشتیبان. کد در جدول تننت `base_currency_confirmations` (bcrypt) ذخیره می‌شود تا نیازی به enum جدید در کنترل‌پلین نباشد. (پسورد در این سامانه وجود ندارد؛ ورود فقط OTP است.)
* **برچسب/واحد**: `me.baseCurrency` (پنل)، `GET public/tenants/:slug/currency` (صفحه‌های عمومی، `PublicCurrencyBoundary`)، `loadUnitLabel()` برای PDF/پیامک/MCP. `formatMoney()` وب جایگزین `formatToman()` شد (تومانِ پلتفرم جدا ماند).
* **مرزها**: درگاه پرداخت — `toGatewayToman()` مبلغ پایه را به تومان صحیح می‌برد (مضرب ۱۰ نبودن در پایه‌ی ریال ⇒ خطای صریح، نه گرد‌کردن بی‌صدا)؛ مودیان — `rialPerUnit` (تومان=۱۰، ریال=۱) و برای ارز پایه‌ی غیر ریالی مانع blocking؛ به‌روزرسانی خودکار نرخ ارز — در پایه‌ی ریال نرخ تومانی ×۱۰ نوشته می‌شود و برای پایه‌ی غیرریالی رد می‌شود.

## ۳. پوشش و محدودیت‌ها (صادقانه)

### تبدیل **نمی‌شود** (و چرا)
| مورد | دلیل / رفتار |
|---|---|
| `Int` بالای ~۲۱۴٬۷۴۸٬۳۶۴ تومان هنگام تومان→ریال | ×۱۰ از سقف INT4 می‌گذرد. **پیش‌نمایش با پیام OVERFLOW مسدود می‌کند.** رفع واقعی = ارتقای ستون‌ها به BigInt و تغییر نوع در کل کد (پروژه‌ی جدا؛ تصمیم لازم). ریال→تومان هیچ مشکلی ندارد. |
| JSON تاریخی/اسنپ‌شات (ActivityLog، DocumentRevision، AiActionRequest، `tax_invoices.payloadSnapshot` و ...) | تاریخی یا بدون مبلغ؛ هر ستون Json در `NOT_CONVERTED` با دلیل ثبت شده و `money-columns.spec` هر ستون Json بدون تصمیم را رد می‌کند. `payloadSnapshot` مودیان همیشه ریال است و مستقل از ارز پایه. |
| قوانین اتوماسیون (`automation` conditions) و آستانه‌های دلخواه کاربر در JSON | واحدشان مشخص نیست؛ پس از تبدیل باید دستی مرور شود (هشدار در مستندات/راهنما). |
| `mentoring_goals` (Float) | شاخص دلخواه، ممکن است مبلغ نباشد. |
| ActivityLog / اعلان‌ها / پیام‌های پیامک قدیمی | متن تاریخی. |
| مبلغ ارز خارجی (`unitPriceFx`, `costPriceFx`, `salePriceFx`) | به ارز پایه وابسته نیست. |
| بسته‌ی پیامک/اشتراک/ماژول | پول پلتفرم اکسیر، همیشه تومان. |
| سقف‌های ثابت کد (مثلاً `MAX_PROPOSAL_AMOUNT`، `@Max` در DTOها) | روی INT4 تنظیم‌اند؛ در پایه‌ی ریال مبلغ‌های بالای ۲٫۱ میلیارد ریال (۲۱۴ میلیون تومان) رد می‌شوند — همان سقف INT4. |
| صفحه‌های عمومی عنوان‌های ثابت «تومان» در متن‌های آزاد، مبلغ‌های ورودی‌ی `book-store`/`ration` که داخل متن‌های دستی کاربر نوشته شده | وابسته به متن کاربر. |

### روش‌های رد‌شده
* **فقط برچسب نمایشی**: ارقام ذخیره‌شده تغییر نمی‌کردند → خواسته‌ی مالک را برآورده نمی‌کرد.
* **افزودن ستون ارز کنار هر مبلغ**: تغییر اسکیما و کد همه‌ی ماژول‌ها، ریسک بسیار بالاتر.
* **تبدیل دسته‌ای ریز (batch commit)**: حالت میانی نیمه‌تبدیل‌شده می‌سازد؛ برای داده‌ی مالی یک تراکنش اتمی امن‌تر است (هزینه: قفل نوشتن روی جدول‌ها و زمان تراکنش؛ برای دیتابیس‌های بسیار بزرگ باید زمان‌سنجی شود).

## ۳.۱ محدودیت سرریز (OVERFLOW) — بدون تغییر، با نمایش شفاف
تومان→ریال مبالغ را ×۱۰ می‌کند و ستون‌های `Int` سقف ۲٬۱۴۷٬۴۸۳٬۶۴۷ دارند (بیش از ~۲۱۴٫۷ میلیون تومان در یک خانه). این محدودیت **عمداً حفظ شده** (ارتقا به BigInt = پروژه‌ی جدا). پیش‌نمایش با پیام فارسی «سرریز: بزرگ‌ترین مقدار ستون `جدول.ستون` برابر … است» مسدود می‌کند و رابط کاربری جدول، ستون و بیشینه‌ی مقدار فعلی را نشان می‌دهد؛ اجرا هم داخل قفل دوباره همین را چک می‌کند و در صورت وجود، تراکنش لغو می‌شود. ریال→تومان همیشه ممکن است.

## ۴. مهاجرت
`apps/backend-core/prisma/tenant/migrations/20261031120000_base_currency_conversion/migration.sql` و `20261107100000_base_currency_confirmation_plan_hash` (ستون `planHash`) — فقط افزودن: `base_currency_conversions`, `base_currency_rounding_log`, `base_currency_confirmations` + ایندکس یکتای جزئی «یک RUNNING». بدون enum، بدون OWNED BY، وضعیت‌ها TEXT. روی یک Postgres 16 دورریختنی همراه با تمام مهاجرت‌های قبلی با موفقیت اعمال شد.

## ۵. تست
* واحد: `rational.spec`, `money-columns.spec` (تطبیق با اسکیما)، `base-currency.service.spec` (مجوز، گیت ماژول، طرح، قفل نوشتن، `toGatewayToman`)، `payment-gateway.service.spec` (ریال)، `invoice-mapper.spec` (مودیان در پایه‌ی ریال).
* یکپارچه روی **Postgres واقعی دورریختنی** (`base-currency.integration.spec.ts`، فقط با `BASE_CURRENCY_TEST_DATABASE_URL`): ×۱۰ دقیق و تراز، ایمپوتنس، سرریز INT4، عبارت/کد اشتباه، رول‌بک، گرد‌کردن + تعدیل تراز + بازگشت دقیق، بازگشت ×۱۰، ممانعت از اجرای هم‌زمان، بازیابی عملیات رهاشده.

## ۶. ریسک‌های باقی‌مانده
1. هیچ‌چیز روی دیتابیس **واقعی یا حجیم** اجرا نشده؛ زمان تراکنش/قفل برای دیتابیس‌های بزرگ نامعلوم است (timeout تراکنش ۳۰ دقیقه، `lock_timeout` ۱۵ ثانیه).
2. نقش محدود دیتابیس تننت (S-14) با `LOCK TABLE` / `CREATE TEMP TABLE` آزموده نشده.
3. پشتیبان‌گیری واقعی (`pg_dump`) در این محیط اجرا نشد؛ فقط مسیر کد و guard بررسی شد.
4. قفل مسیرهای عمومی در حافظه‌ی همان پروسه است (اسلاگ→تننت)؛ در استقرار چندپروسه‌ای، پروسه‌ی دیگر فقط از طریق `LOCK TABLE` دیتابیس و ردیف RUNNING (برای مسیرهای با ctx و کرون‌ها) محافظت می‌شود، نه برای فرم‌های عمومی. کش `loadBaseCurrency` ۵ ثانیه است؛ مسیر درگاه همیشه `fresh` از DB می‌خواند و `sweepStale` (کرون ۲ دقیقه + بوت) عملیات رهاشده‌ی هر پروسه را آزاد می‌کند.
5. callback بازگشت درگاه هنگام تبدیل ۴۲۳ می‌دهد (تأیید بعداً با باز کردن دوباره‌ی لینک).
6. تغییر ارز پایه نیاز به بارگذاری مجدد صفحه برای برچسب‌های ثابت دارد.
