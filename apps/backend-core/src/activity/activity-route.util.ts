/**
 * استخراج «چه کاری روی چه چیزی» از مسیر یک درخواست تغییردهنده، بدون دست‌زدن به کنترلرها.
 * خالص و بدون وابستگی — قابل تست مستقیم.
 */

export type ActionType = 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'cancel' | 'send' | 'status' | 'other';

export type RouteDescription = {
  moduleCode: string;
  /** قالب قدیمی لاگ: ماژول.موجودیت.فعل‌گذشته — هم‌سو با ACTIVITY_LABELS فرانت */
  action: string;
  actionType: ActionType;
  entityType: string;
  /** اگر شناسه‌ی رکورد در مسیر باشد */
  entityId: string | null;
  summary: string;
};

/** اولین بخش‌هایی که هرگز ثبت نمی‌شوند: نویز، ورود/خروج، عمومی و لاگ‌های خود لاگ. */
export const EXCLUDED_FIRST_SEGMENTS = new Set([
  'auth', 'notifications', 'voip', 'me', 'push', 'workspace', 'public', 'admin', 'offline-sync', 'logs', 'activity', 'mcp', 'health',
]);

/** بخش‌های انتهایی نویز: ضربان، خوانده‌شدن اعلان، ردیابی و … */
const NOISE_SEGMENTS = new Set([
  'heartbeat', 'ping', 'presence', 'typing', 'seen', 'read', 'mark-read', 'mark-all-read', 'read-all', 'track', 'telemetry', 'poll', 'refresh', 'token', 'logout', 'login', 'keepalive',
]);

const LABEL_VERBS: Record<ActionType, string> = {
  create: 'ایجاد',
  update: 'ویرایش',
  delete: 'حذف',
  approve: 'تأیید',
  reject: 'رد',
  cancel: 'ابطال/لغو',
  send: 'ارسال',
  status: 'تغییر وضعیت',
  other: 'اقدام روی',
};

/** فعل‌های انتهای مسیر POST → نوع عمل + شکل گذشته برای رشته‌ی action */
const POST_VERBS: Record<string, { type: ActionType; past: string }> = {
  approve: { type: 'approve', past: 'approved' },
  reject: { type: 'reject', past: 'rejected' },
  confirm: { type: 'approve', past: 'confirmed' },
  cancel: { type: 'cancel', past: 'cancelled' },
  void: { type: 'cancel', past: 'voided' },
  send: { type: 'send', past: 'sent' },
  resend: { type: 'send', past: 'sent' },
  remind: { type: 'send', past: 'sent' },
  notify: { type: 'send', past: 'sent' },
  invite: { type: 'send', past: 'invited' },
  status: { type: 'status', past: 'status_changed' },
  stage: { type: 'status', past: 'stage_changed' },
  move: { type: 'status', past: 'stage_changed' },
  archive: { type: 'status', past: 'archived' },
  unarchive: { type: 'status', past: 'unarchived' },
  post: { type: 'status', past: 'posted' },
  decision: { type: 'approve', past: 'decided' },
  sign: { type: 'approve', past: 'signed' },
  receive: { type: 'status', past: 'received' },
  complete: { type: 'status', past: 'completed' },
  close: { type: 'status', past: 'closed' },
  hire: { type: 'status', past: 'hired' },
  refer: { type: 'send', past: 'referred' },
  paraph: { type: 'approve', past: 'paraphed' },
  pay: { type: 'status', past: 'paid' },
  publish: { type: 'status', past: 'published' },
  generate: { type: 'create', past: 'generated' },
  'generate-report': { type: 'create', past: 'generated' },
};

/** اسم فارسی موجودیت، با کلید «بخش۱/بخش۲» (یا فقط بخش۱) — هر چه نباشد، fallback عمومی. */
const ENTITY_LABELS: Record<string, string> = {
  'sales/invoices': 'فاکتور فروش',
  'sales/quotations': 'پیش‌فاکتور',
  'sales/returns': 'برگشت از فروش',
  'sales/recurring-invoices': 'فاکتور دوره‌ای',
  'purchasing/orders': 'سفارش خرید',
  'purchasing/returns': 'برگشت از خرید',
  'purchasing/suppliers': 'تأمین‌کننده',
  'accounting/entries': 'سند حسابداری',
  'accounting/accounts': 'حساب',
  'accounting/budgets': 'بودجه',
  'accounting/fixed-assets': 'دارایی ثابت',
  'accounting/parties': 'تراکنش طرف حساب',
  'accounting/reconciliation': 'مغایرت‌گیری بانکی',
  'crm/contacts': 'مخاطب',
  'crm/deals': 'فرصت فروش',
  'crm/funnel': 'قیف فروش',
  'warehouse/movements': 'حواله/رسید انبار',
  'warehouse/products': 'کالا',
  'warehouse/warehouses': 'انبار',
  'warehouse/settings': 'تنظیمات انبار',
  'hr/employees': 'کارمند',
  'hr/departments': 'دپارتمان',
  'hr/attendance': 'حضور و غیاب',
  'hr/leave': 'درخواست مرخصی',
  'hr/payroll': 'حقوق و دستمزد',
  'hr/penalties': 'جریمه پرسنلی',
  'hr/rewards': 'پاداش پرسنلی',
  'recruitment': 'استخدام',
  'tasks': 'وظیفه',
  'daily-checklist': 'چک‌لیست روزانه',
  'reports': 'گزارش',
  'projects': 'پروژه',
  'contracts': 'قرارداد',
  'proposals': 'پیشنهاد',
  'booking/appointments': 'نوبت',
  'booking/service-types': 'نوع خدمت',
  'booking/my-availability': 'ساعات در دسترس',
  'production/boms': 'فرمول ساخت (BOM)',
  'production/orders': 'سفارش تولید',
  'production/work-centers': 'مرکز کاری',
  'quality-control/samples': 'نمونه کنترل کیفیت',
  'quality-control/test-types': 'نوع آزمون',
  'ration-lab/samples': 'نمونه آزمایشگاه',
  'ration-lab/reports': 'گزارش آزمایشگاه',
  'mentoring/engagements': 'قرارداد منتورینگ',
  'mentoring/sessions': 'جلسه منتورینگ',
  'mentoring/goals': 'هدف منتورینگ',
  'events': 'رویداد',
  'forms': 'فرم',
  'fleet/shipments': 'محموله',
  'fleet/drivers': 'راننده',
  'warranty': 'گارانتی',
  'after-sales-service': 'خدمات پس از فروش',
  'online-store/products': 'محصول فروشگاه',
  'online-store/orders': 'سفارش فروشگاه',
  'online-store/reviews': 'نظر مشتری',
  'marketing/campaigns': 'کمپین بازاریابی',
  'referral-marketing': 'بازاریابی ارجاعی',
  'qr-codes': 'کد QR',
  'checks': 'چک',
  'certificates': 'گواهی',
  'confidential-archive': 'آرشیو محرمانه',
  'approvals': 'تأییدیه',
  'automation': 'قانون اتوماسیون',
  'tax': 'صورتحساب مالیاتی',
  'support/tickets': 'تیکت پشتیبانی',
  'attachments': 'پیوست',
  'book-store': 'فروشگاه کتاب',
  'settings/general': 'تنظیمات عمومی',
  'settings/api-keys': 'کلید API',
  'settings/webhooks': 'وب‌هوک',
  'settings/currencies': 'ارز',
  'settings/backup': 'پشتیبان‌گیری',
  'sms-panel': 'پنل پیامکی',
  'roles': 'نقش',
  'users': 'کاربر',
  'modules': 'ماژول',
  'billing': 'صورتحساب اشتراک',
  'payment-gateway': 'درگاه پرداخت',
  'scheduling': 'زمان‌بندی خودکار',
  'dashboard': 'داشبورد',
};

/** مسیر → کد ماژول (برای قطعه‌های اول که با کد ماژول یکی نیستند). */
const FIRST_SEGMENT_MODULE: Record<string, string> = {
  'qr-codes': 'qr-code',
  roles: 'users',
  users: 'users',
  modules: 'modules',
  settings: 'settings',
  'sms-panel': 'sms',
  billing: 'billing',
  'payment-gateway': 'payment-gateway',
  scheduling: 'settings',
  dashboard: 'dashboard',
  attachments: 'attachments',
  approvals: 'approvals',
  'ai-actions': 'ai',
};

export const MODULE_LABELS: Record<string, string> = {
  crm: 'مشتریان (CRM)', sales: 'فروش', purchasing: 'خرید', accounting: 'حسابداری', warehouse: 'انبار', hr: 'منابع انسانی',
  recruitment: 'استخدام', tasks: 'وظایف', 'daily-checklist': 'چک‌لیست روزانه', reports: 'گزارش‌ها', projects: 'پروژه‌ها',
  contracts: 'قراردادها', proposals: 'پیشنهادها', booking: 'نوبت‌دهی', production: 'تولید', 'quality-control': 'کنترل کیفیت',
  'ration-lab': 'آزمایشگاه جیره', mentoring: 'منتورینگ', events: 'رویدادها', forms: 'فرم‌ساز', fleet: 'ناوگان', warranty: 'گارانتی',
  'after-sales': 'خدمات پس از فروش', 'after-sales-service': 'خدمات پس از فروش', 'online-store': 'فروشگاه آنلاین', marketing: 'بازاریابی',
  'referral-marketing': 'بازاریابی ارجاعی', 'qr-code': 'کد QR', checks: 'چک‌ها', certificates: 'گواهی‌ها', automation: 'اتوماسیون',
  tax: 'مالیات', sms: 'پیامک', users: 'کاربران و نقش‌ها', modules: 'ماژول‌ها', settings: 'تنظیمات', billing: 'اشتراک', approvals: 'تأییدیه‌ها',
  support: 'پشتیبانی', 'confidential-archive': 'آرشیو محرمانه', 'book-store': 'فروشگاه کتاب', 'payment-gateway': 'درگاه پرداخت',
  dashboard: 'داشبورد', attachments: 'پیوست‌ها', system: 'سیستم', ai: 'دستیار هوشمند',
};

const isParamSegment = (s: string) => s.startsWith(':');
const isIdLike = (s: string) => /^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(s) || /^\d+$/.test(s);

/** رشته‌ی ماسک‌شده برای ثبت در لاگ — فقط اگر واقعاً شبیه شناسه‌ی رکورد باشد (نه توکن). */
const SECRET_PARAM_RE = /token|secret|otp|code|key|password|signature/i;
const SAFE_ID_RE = /^[0-9a-zA-Z_-]{1,64}$/;

export function normalizeRoutePath(path: string): string[] {
  return path
    .split('?')[0]
    .replace(/^\/+/, '')
    .replace(/^api\//, '')
    .split('/')
    .filter(Boolean);
}

function entityLabel(staticSegs: string[]): string | null {
  const two = staticSegs.slice(0, 2).join('/');
  return ENTITY_LABELS[two] ?? ENTITY_LABELS[staticSegs[0]] ?? null;
}

export function isExcludedRoute(segments: string[]): boolean {
  if (segments.length === 0) return true;
  if (EXCLUDED_FIRST_SEGMENTS.has(segments[0])) return true;
  return segments.some((s) => NOISE_SEGMENTS.has(s));
}

/**
 * @param method HTTP method
 * @param routePattern قالب مسیر (req.route.path مثل /api/crm/contacts/:id) — اگر نبود، مسیر واقعی
 * @param actualPath مسیر واقعی برای استخراج شناسه وقتی قالب پارامتر ندارد
 * @param requireModule متادیتای @RequireModule اگر وجود داشت
 * @returns null برای مسیرهای مستثنی یا متدهای غیرتغییردهنده
 */
export function describeRoute(method: string, routePattern: string, actualPath: string, requireModule?: string): RouteDescription | null {
  const m = method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m)) return null;

  const patternSegs = normalizeRoutePath(routePattern);
  if (isExcludedRoute(patternSegs)) return null;

  const actualSegs = normalizeRoutePath(actualPath);
  // شناسه‌ی رکورد: اولین پارامتر مسیر (از روی مسیر واقعی هم‌موقعیت) — یا اولین بخش شبیه UUID/عدد
  let entityId: string | null = null;
  for (let i = 0; i < patternSegs.length; i += 1) {
    if (isParamSegment(patternSegs[i]) && !SECRET_PARAM_RE.test(patternSegs[i]) && actualSegs[i] && SAFE_ID_RE.test(actualSegs[i]) && (isIdLike(actualSegs[i]) || actualSegs[i].length <= 40)) {
      entityId = actualSegs[i];
      break;
    }
  }
  if (!entityId) entityId = actualSegs.find((s) => isIdLike(s)) ?? null;

  const staticSegs = patternSegs.filter((s) => !isParamSegment(s) && !isIdLike(s));
  if (staticSegs.length === 0) return null;
  const last = staticSegs[staticSegs.length - 1];
  const postVerb = m === 'POST' && staticSegs.length > 1 ? POST_VERBS[last] : undefined;

  let actionType: ActionType;
  let past: string;
  if (postVerb) {
    actionType = postVerb.type;
    past = postVerb.past;
  } else if (m === 'POST') {
    actionType = 'create';
    past = 'created';
  } else if (m === 'DELETE') {
    actionType = 'delete';
    past = 'deleted';
  } else {
    actionType = 'update';
    past = 'updated';
  }

  const nameSegs = postVerb ? staticSegs.slice(0, -1) : staticSegs;
  const first = nameSegs[0] ?? staticSegs[0];
  const moduleCode = requireModule ?? FIRST_SEGMENT_MODULE[first] ?? first;
  const entityType = nameSegs.slice(1).join('.') || 'record';

  const noun = entityLabel(nameSegs) ?? (entityType !== 'record' ? entityType : (MODULE_LABELS[moduleCode] ?? first));
  const verbLabel = postVerb ? postVerbLabel(last) ?? LABEL_VERBS[actionType] : LABEL_VERBS[actionType];
  const summary = `${verbLabel} ${noun}`.trim();

  return { moduleCode, action: `${first}.${entityType}.${past}`, actionType, entityType, entityId, summary };
}

/** برچسب فارسی دقیق‌تر برای فعل‌های متداول POST */
function postVerbLabel(verb: string): string | null {
  const map: Record<string, string> = {
    approve: 'تأیید', reject: 'رد', confirm: 'تأیید نهایی', cancel: 'لغو', void: 'ابطال', send: 'ارسال', resend: 'ارسال مجدد', remind: 'یادآوری',
    notify: 'اطلاع‌رسانی', invite: 'دعوت', status: 'تغییر وضعیت', stage: 'تغییر مرحله', move: 'جابه‌جایی مرحله', archive: 'بایگانی',
    unarchive: 'خروج از بایگانی', post: 'ثبت قطعی', decision: 'تصمیم‌گیری', sign: 'امضای', receive: 'ثبت دریافت', complete: 'تکمیل',
    close: 'بستن', hire: 'جذب نهایی', refer: 'ارجاع', paraph: 'پاراف', pay: 'ثبت پرداخت', publish: 'انتشار', generate: 'تولید',
    'generate-report': 'ثبت گزارش روزانه',
  };
  return map[verb] ?? null;
}
