/**
 * فهرست یگانه‌ی همه‌ی ستون‌های «مبلغ» دیتابیس تننت که هنگام تغییر ارز پایه بازمقیاس می‌شوند.
 * `money-columns.spec.ts` این فهرست را با prisma/tenant/schema.prisma تطبیق می‌دهد: هر ستون مبلغیِ تازه
 * باید یا اینجا باشد یا با دلیل در NOT_CONVERTED — وگرنه تست می‌شکند و کسی «یادش نمی‌رود».
 */

export type MoneyKind = 'int4' | 'int8';

export type MoneyColumn = {
  table: string;
  column: string;
  kind: MoneyKind;
  /** برچسب فارسی گروه برای گزارش پیش‌نمایش */
  group: string;
};

/** ستون‌های ضریب‌دار با نرخ تبدیل مبلغ‌-به-ازای-واحد-ارز-خارجی (DECIMAL(18,4))؛ با همان ضریب بازمقیاس می‌شوند. */
export type RateColumn = { table: string; column: string; group: string };

const c = (group: string, table: string, cols: string[], kind: MoneyKind = 'int4'): MoneyColumn[] =>
  cols.map((column) => ({ table, column, kind, group }));

export const MONEY_COLUMNS: MoneyColumn[] = [
  ...c('فروش', 'sales_invoices', ['subtotal', 'discount', 'taxAmount', 'total', 'paidAmount']),
  ...c('فروش', 'sales_invoice_lines', ['unitPrice', 'lineTotal']),
  ...c('فروش', 'sales_quotations', ['subtotal', 'discount', 'total']),
  ...c('فروش', 'sales_quotation_lines', ['unitPrice', 'lineTotal']),
  ...c('فروش', 'sales_returns', ['subtotal', 'total']),
  ...c('فروش', 'sales_return_lines', ['unitPrice', 'lineTotal']),
  ...c('فروش', 'sales_recurring_invoice_templates', ['discount']),
  ...c('فروش', 'sales_recurring_invoice_lines', ['unitPrice']),
  ...c('فروش', 'sales_payments', ['amount']),
  ...c('فروش', 'dispatch_invoice_adjustments', ['oldSubtotal', 'newSubtotal', 'oldDiscount', 'newDiscount', 'oldTaxAmount', 'newTaxAmount', 'oldTotal', 'newTotal']),
  ...c('خرید', 'purchase_orders', ['subtotal', 'total', 'paidAmount']),
  ...c('خرید', 'purchase_order_lines', ['unitCost', 'lineTotal']),
  ...c('خرید', 'purchase_returns', ['subtotal', 'total']),
  ...c('خرید', 'purchase_return_lines', ['unitCost', 'lineTotal']),
  ...c('خرید', 'purchase_payments', ['amount']),
  ...c('چک و حساب طرف‌ها', 'checks', ['amount']),
  ...c('چک و حساب طرف‌ها', 'party_transactions', ['amount']),
  ...c('حسابداری', 'accounting_journal_lines', ['debit', 'credit'], 'int8'),
  ...c('حسابداری', 'accounting_bank_statement_lines', ['amount'], 'int8'),
  ...c('حسابداری', 'accounting_budget_lines', ['amount']),
  ...c('حسابداری', 'accounting_fixed_assets', ['purchaseCost', 'salvageValue', 'disposalAmount', 'postedDepreciation']),
  ...c('حسابداری', 'accounting_bank_accounts', ['openingBalance'], 'int8'),
  ...c('حسابداری', 'accounting_cash_boxes', ['openingBalance'], 'int8'),
  ...c('حسابداری', 'accounting_bank_transactions', ['amount'], 'int8'),
  ...c('انبار و کالا', 'warehouse_products', ['costPrice', 'salePrice', 'publicCompareAtPrice']),
  ...c('انبار و کالا', 'warehouse_stock_movements', ['unitCost']),
  ...c('انبار و کالا', 'warehouse_stock_import_batches', ['totalValue'], 'int8'),
  ...c('منابع انسانی', 'hr_employees', ['baseSalary']),
  ...c('منابع انسانی', 'hr_payroll_slips', ['baseSalary', 'allowances', 'deductions', 'insuranceAmount', 'taxAmount']),
  ...c('منابع انسانی', 'hr_personnel_rewards', ['amount']),
  ...c('منابع انسانی', 'hr_personnel_penalties', ['amount']),
  ...c('استخدام', 'recruitment_job_postings', ['publishBudget']),
  ...c('استخدام', 'recruitment_offers', ['salary']),
  ...c('مشتریان و فروش‌های CRM', 'crm_contacts', ['acquisitionCost', 'bankAvgMonthlyTurnover', 'creditLimitOverride']),
  ...c('مشتریان و فروش‌های CRM', 'crm_purchase_events', ['amount']),
  ...c('مشتریان و فروش‌های CRM', 'crm_deals', ['value'], 'int8'),
  ...c('قرارداد و پروژه و پیشنهاد', 'contracts', ['value']),
  ...c('قرارداد و پروژه و پیشنهاد', 'projects', ['budget']),
  ...c('قرارداد و پروژه و پیشنهاد', 'proposals', ['amount']),
  ...c('قرارداد و پروژه و پیشنهاد', 'proposal_templates', ['amount']),
  ...c('مربیگری', 'mentoring_engagements', ['hourlyRate', 'packagePrice', 'subscriptionMonthlyPrice']),
  ...c('نوبت‌دهی', 'service_types', ['price', 'depositAmount']),
  ...c('نوبت‌دهی', 'appointments', ['depositAmount']),
  ...c('فروشگاه آنلاین', 'store_orders', ['subtotal']),
  ...c('فروشگاه آنلاین', 'store_order_lines', ['unitPrice', 'lineTotal']),
  ...c('فروشگاه آنلاین', 'book_orders', ['unitPrice']),
  ...c('رویداد', 'event_ticket_types', ['price']),
  ...c('رویداد', 'event_bookings', ['unitPrice', 'totalAmount']),
  ...c('بازاریابی و معرفی', 'marketing_campaigns', ['attributedRevenue']),
  ...c('بازاریابی و معرفی', 'reseller_settlements', ['totalCommission', 'paidCommission', 'amountDue']),
  ...c('بازاریابی و معرفی', 'referral_commissions', ['amount']),
  ...c('آزمایشگاه جیره', 'ration_samples', ['analysisFeeAmount', 'finalFeeAmount']),
  ...c('آزمایشگاه جیره', 'ration_formula_lines', ['unitCostSnapshot', 'lineCost']),
];

/** DECIMAL(18,4): نرخ‌های «هر واحد ارز خارجی = چند واحد پایه» — با ضریب تبدیل ضرب می‌شوند. */
export const RATE_COLUMNS: RateColumn[] = [
  { table: 'currencies', column: 'rate', group: 'ارزها' },
  { table: 'sales_invoice_lines', column: 'exchangeRateFx', group: 'فروش' },
  { table: 'sales_quotation_lines', column: 'exchangeRateFx', group: 'فروش' },
  { table: 'purchase_order_lines', column: 'exchangeRateFx', group: 'خرید' },
];

/** تنظیمات ModuleSetting که مقدار عددی مبلغی دارند. */
export type JsonSettingSpec =
  | { moduleCode: string; key: string; kind: 'number' }
  | { moduleCode: string; key: string; kind: 'object'; fields: string[] };

export const MONEY_SETTINGS: JsonSettingSpec[] = [
  { moduleCode: 'purchasing', key: 'approvalThreshold', kind: 'number' },
  { moduleCode: 'book-store', key: 'settings', kind: 'object', fields: ['printPriceToman', 'ebookPriceToman', 'audioPriceToman'] },
  { moduleCode: 'payroll', key: 'taxInsuranceRates', kind: 'object', fields: ['taxExemptionMonthly'] },
];

/** ستون‌های رشته‌ای «کد ارز» که با کد ارز پایه‌ی جدید جایگزین می‌شوند (فقط ردیف‌هایی که کد قدیم را دارند). */
export const CURRENCY_CODE_COLUMNS: Array<{ table: string; column: string }> = [{ table: 'accounting_bank_accounts', column: 'currency' }];

/**
 * ستون‌های مبلغ‌گونه که عمداً بازمقیاس نمی‌شوند — با دلیل. تطبیق‌دهنده‌ی اسکیما از این فهرست استفاده می‌کند.
 * کلید: "Model.field".
 */
export const NOT_CONVERTED: Record<string, string> = {
  'SalesInvoice.taxRate': 'درصد است، نه مبلغ',
  'SalesInvoice.paymentRefId': 'شناسه‌ی مرجع درگاه است',
  'RecurringInvoiceTemplate.taxRate': 'درصد است',
  'Appointment.paymentRefId': 'شناسه‌ی مرجع درگاه',
  'StoreOrder.paymentRefId': 'شناسه‌ی مرجع درگاه',
  'EventBooking.paymentRefId': 'شناسه‌ی مرجع درگاه',
  'BookOrder.paymentRefId': 'شناسه‌ی مرجع درگاه',
  'ResellerProfile.commissionFirstPaymentPercent': 'درصد',
  'ResellerProfile.commissionRenewalPercent': 'درصد',
  'Product.profitMarginPercent': 'درصد',
  'RationSample.discountPercent': 'درصد',
  'TaxSettings.defaultVatRate': 'درصد',
  'TaxProductCode.vatRate': 'درصد',
  'SalesInvoiceLine.unitPriceFx': 'مبلغ به ارز خارجی است و به ارز پایه وابسته نیست',
  'SalesQuotationLine.unitPriceFx': 'مبلغ به ارز خارجی',
  'PurchaseOrderLine.unitCostFx': 'مبلغ به ارز خارجی',
  'Product.costPriceFx': 'مبلغ به ارز خارجی',
  'Product.salePriceFx': 'مبلغ به ارز خارجی',
  'MentoringGoal.baselineValue': 'شاخص دلخواه کاربر (ممکن است مبلغ نباشد)؛ واحدش مشخص نیست',
  'MentoringGoal.targetValue': 'شاخص دلخواه کاربر',
  'MentoringGoalCheckIn.value': 'شاخص دلخواه کاربر',
  'QualitySampleResult.measuredValue': 'کمیت آزمایشگاهی، نه مبلغ',
  'RationSample.totalHerdMilkYieldLiters': 'لیتر',
  'RationFollowUpCheckin.totalHerdMilkYieldLiters': 'لیتر',
  'ShipmentLoading.grossKg': 'وزن',
  'ShipmentLoading.netKg': 'وزن',
  'DispatchDocRule.minNetKg': 'وزن',
  'DispatchInvoiceAdjustment.netWeightKg': 'وزن',
  'ModuleSetting.value': 'JSON عمومی؛ کلیدهای مبلغی در MONEY_SETTINGS',
  'Contract.customFieldValues': 'JSON فیلدهای دلخواه',
  // ── ستون‌های Json: هر کدام یا در JSON_MONEY_COLUMNS (json-money.ts) تبدیل می‌شود یا اینجا با دلیل ──
  'TaskEvent.meta': 'فراداده‌ی رویداد وظیفه — مبلغی نیست',
  'ActivityLog.metadata': 'لاگ فعالیت — تاریخی و تغییرناپذیر',
  'ErrorLog.context': 'لاگ خطا — فنی',
  'NotificationPreference.categoryPrefs': 'ترجیح اعلان — مبلغی نیست',
  'DocumentRevision.before': 'نسخه‌ی تاریخی سند — مقدارها به واحد زمان ثبت‌اند (اسنپ‌شات)',
  'DocumentRevision.after': 'نسخه‌ی تاریخی سند — اسنپ‌شات',
  'DocumentRevision.changes': 'فهرست تغییرات تاریخی — اسنپ‌شات',
  'AutomationAction.config': 'پیکربندی اتوماسیون — ممکن است آستانه‌ی مبلغی دلخواه داشته باشد؛ ساختار آزاد، پس از تبدیل باید دستی مرور شود',
  'VoipProviderConfig.config': 'تنظیمات ارائه‌دهنده‌ی تلفن — مبلغی نیست',
  'AiActionRequest.arguments': 'آرگومان‌های تاریخی درخواست ایجنت (به واحد زمان درخواست)',
  'AiActionRequest.result': 'نتیجه‌ی تاریخی درخواست ایجنت',
  'StoreAnalyticsEvent.meta': 'فراداده‌ی رویداد تحلیلی — تاریخی',
  'MarketingCampaign.audienceFilter': 'معیار فیلتر مخاطبان هنگام ساخت کمپین — اسنپ‌شات تاریخی',
  'FormSubmission.sourceMeta': 'فراداده‌ی منبع فرم — مبلغی نیست',
  'TaxInvoice.overrides': 'ورودی‌های دستی مودیان — مبلغی نیست',
  'TaxInvoice.payloadSnapshot': 'payload منجمد ارسالی به مودیان؛ همیشه ریال و مستقل از ارز پایه',
  'TaxInvoice.errors': 'خطاهای مودیان — متن',
  'TaxSubmissionLog.summary': 'لاگ ارسال مودیان — تاریخی',
  'SignatureEvidence.device': 'مشخصات دستگاه — مبلغی نیست',
  'ShipmentEvent.meta': 'فراداده‌ی رویداد حمل — مبلغی نیست',
  'DashboardLayout.layout': 'چیدمان داشبورد',
  'UserOffboardingRun.counts': 'شمارنده‌های خروج کاربر',
  'UserOffboardingRun.details': 'جزئیات خروج کاربر',
  'CorrLetterhead.layoutJson': 'طرح سربرگ',
  'CorrLetter.recipients': 'گیرندگان نامه',
  'CorrLetter.signatureBlock': 'بلوک امضا',
  'CorrEvent.meta': 'خط‌زمان نامه',
  'CorrRevision.before': 'نسخه‌ی تاریخی نامه',
  'CorrRevision.after': 'نسخه‌ی تاریخی نامه',
  'SyncIdempotency.responseBody': 'پاسخ موقت همگام‌سازی (۷ روز)',
  'BaseCurrencyConversion.report': 'گزارش همین ماژول',
};

export const COLUMN_KEY = (m: { table: string; column: string }) => `${m.table}.${m.column}`;

/** اعتبارسنجی ایمنی: نام جدول/ستون هرگز از ورودی کاربر نمی‌آید، ولی برای اطمینان قبل از ساخت SQL چک می‌شود. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function assertIdent(name: string): string {
  if (!IDENT.test(name)) throw new Error(`شناسه‌ی SQL نامعتبر: ${name}`);
  return name;
}
export const qi = (name: string) => `"${assertIdent(name)}"`;

/** گروه‌بندی ستون‌ها بر حسب جدول. */
export function groupByTable(cols: MoneyColumn[] = MONEY_COLUMNS): Map<string, MoneyColumn[]> {
  const m = new Map<string, MoneyColumn[]>();
  for (const col of cols) {
    const list = m.get(col.table) ?? [];
    list.push(col);
    m.set(col.table, list);
  }
  return m;
}
