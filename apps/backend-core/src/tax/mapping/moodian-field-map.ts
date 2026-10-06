/**
 * ============================================================================
 * تنها منبع «نگاشت فیلدها، الگوها، نوع‌ها و ثابت‌های پروتکل» سامانه مودیان.
 * ============================================================================
 * مبنا: «دستورالعمل فنی نحوه اتصال به سامانه مودیان» RC_TICS.IS_V01 — خرداد ۱۴۰۱.
 * این سند قدیمی است؛ هر قاعده‌ای که تغییر کرد فقط همین فایل (و جدول‌های قابل ویرایش DB برای
 * نرخ و کد کالا) باید عوض شود، نه منطق سرویس‌ها. هنگام تغییر، MOODIAN_MAPPING_VERSION را بالا ببرید؛
 * هر TaxInvoice نسخه‌ی نگاشتی را که با آن منجمد شده ذخیره می‌کند.
 *
 * هر ثابتی که با «NEEDS-SANDBOX-VERIFICATION» علامت خورده تنها از متن سند برداشت شده و هنوز
 * با سرور واقعی/آزمایشی سازمان امور مالیاتی راستی‌آزمایی نشده است.
 */

export const MOODIAN_MAPPING_VERSION = '1401.04/RC_TICS.IS_V01';

/**
 * واحد پول. اکسیر مبالغ را به «تومان» نگه می‌دارد؛ سامانه مودیان «ریال» می‌خواهد (۱ تومان = ۱۰ ریال).
 * NEEDS-SANDBOX-VERIFICATION: سند ۱۴۰۱ صراحتاً «ریال» نمی‌گوید (نمونه‌ها عدد بدون واحدند)؛
 * بر پایه‌ی قوانین رسمی صورتحساب الکترونیکی (ریال) فرض شده. تنها نقطه‌ی تبدیل همین ثابت است.
 */
export const TOMAN_TO_RIAL = 10;

/** نوع صورتحساب (inty) — جدول ۷ ردیف ۴. */
export const INVOICE_TYPE = { TYPE_1: 1, TYPE_2: 2, TYPE_3: 3 } as const;

/** الگوی صورتحساب (inp) — جدول ۷ ردیف ۷. فاز ۱ فقط الگوی ۱ (فروش) را می‌سازد. */
export const INVOICE_PATTERN = {
  SALE: 1,
  FX_SALE: 2,
  GOLD_JEWELRY: 3,
  CONTRACTOR: 4,
  UTILITY_BILL: 5,
  AIRLINE_TICKET: 6,
} as const;
/** الگوهایی که این نسخه‌ی کد واقعاً می‌سازد/اعتبارسنجی می‌کند. */
export const SUPPORTED_PATTERNS: readonly number[] = [INVOICE_PATTERN.SALE];

/** موضوع صورتحساب (ins) — جدول ۷ ردیف ۸. */
export const INVOICE_SUBJECT_CODE = { ORIGINAL: 1, CORRECTION: 2, CANCELLATION: 3, RETURN: 4 } as const;
export type TaxSubjectKey = keyof typeof INVOICE_SUBJECT_CODE;
/** موضوع‌هایی که باید irtaxid (شماره‌ی مالیاتی صورتحساب مرجع) داشته باشند — خطای ۹ جدول ۱۴. */
export const SUBJECTS_REQUIRING_REFERENCE: readonly TaxSubjectKey[] = ['CORRECTION', 'CANCELLATION', 'RETURN'];

/** نوع شخص خریدار (tob) — جدول ۷ ردیف ۱۰. */
export const BUYER_TYPE = { INDIVIDUAL: 1, LEGAL: 2, CIVIL_PARTNERSHIP: 3, FOREIGN: 4, FINAL_CONSUMER: 5 } as const;

/** روش تسویه (setm) — جدول ۷ ردیف ۲۸. */
export const SETTLEMENT = { CASH: 1, CREDIT: 2, CASH_CREDIT: 3 } as const;

/**
 * نمایش «نرخ مالیات» در بدنه (vra). نمونه‌ی سند ۱۴۰۱ مقدار کسری (۰٫۰۹) دارد، ولی پاسخ
 * GET_SERVICE_STUFF_LIST درصد (۹) برمی‌گرداند. NEEDS-SANDBOX-VERIFICATION.
 */
export const VAT_RATE_REPRESENTATION: 'FRACTION' | 'PERCENT' = 'FRACTION';

export const PACKET_TYPE_INVOICE = 'INVOICE.V01';

/** پیشوند آدرس محیط واقعی (self-tsp: هر تننت خودش مودی است). */
export const PRODUCTION_BASE_URL = 'https://tp.tax.gov.ir/req/api/self-tsp/';
/** آدرس پایه‌ی آزمایشی فقط از تنظیمات تننت می‌آید؛ دامنه باید زیر tax.gov.ir باشد و https. */
export const ALLOWED_HOST_SUFFIX = 'tax.gov.ir';

export const API_PATHS = {
  GET_TOKEN: 'sync/GET_TOKEN',
  GET_SERVER_INFORMATION: 'sync/GET_SERVER_INFORMATION',
  GET_FISCAL_INFORMATION: 'sync/GET_FISCAL_INFORMATION',
  INQUIRY_BY_UID: 'sync/INQUIRY_BY_UID',
  INQUIRY_BY_REFERENCE_NUMBER: 'sync/INQUIRY_BY_REFERENCE_NUMBER',
  GET_SERVICE_STUFF_LIST: 'sync/GET_SERVICE_STUFF_LIST',
  SEND_NORMAL: 'async/normal-enqueue',
} as const;

/**
 * سرآیندهایی که همراه بدنه در امضای درخواست «ادغام» می‌شوند (سند ۶-۲-۱: Header و Body ادغام).
 * NEEDS-SANDBOX-VERIFICATION: سند فهرست دقیق را نمی‌دهد (شکل ۲ متن ندارد)؛ فقط این دو فرض شده‌اند.
 */
export const SIGNED_HEADER_NAMES = ['requestTraceId', 'timestamp'] as const;

/** مرتب‌سازی کلیدها در نرمال‌سازی؛ جاوا Collator(ENGLISH) و دات‌نت OrderBy(فرهنگ) — اینجا ordinal. NEEDS-SANDBOX-VERIFICATION. */
export const KEY_SORT_MODE: 'ORDINAL' = 'ORDINAL';

/**
 * کلید عناصر آرایه در نرمال‌سازی: جاوا «E0», «E1»... و دات‌نت «0», «1»... (دو نمونه‌ی سند یکی نیستند).
 * NEEDS-SANDBOX-VERIFICATION. با تغییر این مقدار، مرتب‌سازی کلیدها هم عوض می‌شود.
 */
export const ARRAY_INDEX_KEY_PREFIX = '';

/**
 * XOR با کلید متقارن (سند ۶-۳): متن می‌گوید «هر بلاک ۲۵۶ بیتی با کلید XOR شود» (PER_BLOCK)،
 * ولی کد جاوای پیوست فقط ۳۲ بایت اول را XOR می‌کند و بقیه را دست‌نخورده کپی می‌کند (FIRST_BLOCK_ONLY).
 * NEEDS-SANDBOX-VERIFICATION. پیش‌فرض: همان متن سند.
 */
export const XOR_MODE: 'PER_BLOCK' | 'FIRST_BLOCK_ONLY' = 'PER_BLOCK';

/**
 * کلید متقارن قبل از رمزگذاری RSA: کد جاوای سند «String» می‌گیرد (نمونه‌ی hex) → hex به UTF-8.
 * NEEDS-SANDBOX-VERIFICATION.
 */
export const SYMMETRIC_KEY_WRAP_ENCODING: 'HEX_UTF8' | 'RAW' = 'HEX_UTF8';

/** حداکثر تعداد بسته در یک درخواست (خطای ۵۰۰۶: در حال حاضر ۱۰۰). */
export const MAX_PACKETS_PER_REQUEST = 100;

/** ابعاد/الگوی فیلدهای ورودی. اعداد طول از جدول ۷ سند؛ طول شماره اقتصادی در سند ناخوانا (۱۰ یا ۱۴) → هر دو پذیرفته. */
export const PATTERNS = {
  taxid: /^[0-9A-Fa-f]{22}$/,
  inno: /^[0-9A-Fa-f]{10}$/,
  economicCode: /^(\d{10}|\d{14})$/,
  fiscalId: /^[0-9A-Za-z]{6}$/,
  sstid: /^\d{13}$/,
  postalCode: /^\d{10}$/,
  nationalId: /^\d{10}$/,
  legalId: /^\d{11}$/,
} as const;

/** وضعیت‌های استعلام (سند ۲-۴ پیوست ۲) → نتیجه‌ی داخلی. هر چیز ناشناخته «هنوز در جریان» حساب می‌شود. */
export const INQUIRY_STATUS = { SUCCESS: 'SUCCESS', FAILED: 'FAILED', PENDING: 'PENDING' } as const;

/** مشخصات فیلدهای header با مقدار پیش‌فرض null (طبق سند فیلد بدون مقدار یا null یا حذف). برای امضای پایدار همیشه همه با null می‌آیند. */
export const HEADER_KEYS = [
  'taxid', 'indatim', 'indati2m', 'inty', 'inno', 'irtaxid', 'inp', 'ins', 'tins', 'tob', 'bid', 'tinb', 'sbc', 'bpc', 'bbc', 'ft',
  'bpn', 'scln', 'scc', 'crn', 'billid', 'tprdis', 'tdis', 'tadis', 'tvam', 'todam', 'tbill', 'setm', 'cap', 'insp', 'tvop', 'dpvb', 'tax17',
] as const;

export const BODY_KEYS = [
  'sstid', 'sstt', 'mu', 'am', 'fee', 'cfee', 'cut', 'exr', 'prdis', 'dis', 'adis', 'vra', 'vam', 'odt', 'odr', 'odam', 'olt', 'olr',
  'olam', 'consfee', 'spro', 'bros', 'tcpbs', 'cop', 'vop', 'bsrn', 'tsstam',
] as const;

export const PAYMENT_KEYS = ['iinn', 'acn', 'trmn', 'trn', 'pcn', 'pid', 'pdt'] as const;

/** نرخ ارزش افزوده‌ی درصدی → مقدار vra طبق VAT_RATE_REPRESENTATION. */
export function vatRateToWire(percent: number): number {
  return VAT_RATE_REPRESENTATION === 'FRACTION' ? Math.round(percent * 100) / 10000 : percent;
}
