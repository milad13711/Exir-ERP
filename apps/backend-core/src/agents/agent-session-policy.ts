/**
 * سیاست نشست «نماینده»: کاربر دارای نقش isAgentRole در سرور فقط به مسیرهای زیر دسترسی دارد؛ بقیه ۴۰۳.
 * (الگوی مشابه isAllowedForRestrictedSession در auth/tenant-two-factor-policy.ts). JwtAuthGuard این را اعمال می‌کند.
 */
const ALLOWED_PREFIXES = [
  '/api/agents/', // ماژول نمایندگی (دسترسی داده‌ای را PermissionsService/دامنه‌ی «فقط خودم» تعیین می‌کند)
  '/api/tasks', // وظایف
  '/api/daily-checklist', // لیست کارهای روزانه
  '/api/dashboard/reminders', // یادآوری‌های شخصی
  '/api/messenger', // پیام‌رسان داخلی (رسانه/گروه‌ها هم زیر همین مسیر)
  '/api/approvals', // کارتابل تأیید (سرویس فقط اسناد ارجاع‌شده به خودِ کاربر را برمی‌گرداند)
  '/api/me', // پروفایل شخصی، منو، سوییچر محیط کاری
  '/api/modules', // فهرست ماژول‌های نصب‌شده برای ساخت منو
  '/api/notifications',
  '/api/push',
  '/api/auth/', // خروج/تغییر محیط/2FA شخصی
  '/api/referral-marketing/me', // دید قدیمی خودِ نماینده
  '/api/attachments', // پیوست وظایف (دسترسی خودِ موجودیت جدا بررسی می‌شود)
  '/api/signature-evidence', // مدارک امضا (خودش با ماتریس دسترسی کنترل می‌شود)
  '/api/sync', // همگام‌سازی آفلاین وظایف/چک‌لیست
  '/api/billing/subscription-summary',
  '/api/platform/me',
  '/api/license',
];
const ALLOWED_EXACT = new Set([
  'GET /api/agents',
  'GET /api/license/status',
  'POST /api/security/csp-report',
  // داشبورد نماینده: فقط چیدمان (سرور به ویجت‌های AGENT_DASHBOARD_WIDGETS محدود می‌کند) و تقویم (به‌تفکیک مجوز ماژول فیلتر می‌شود)
  'GET /api/dashboard/layout',
  'PUT /api/dashboard/layout/me',
  'DELETE /api/dashboard/layout/me',
  'GET /api/dashboard/calendar',
]);
/** تعیین مدیر تأییدکننده‌ی ماژول‌ها مدیریتی است؛ حتی اگر سرویس هم رد کند، از نشست نماینده بسته است. */
const DENIED_PREFIXES = ['/api/approvals/module-approvers'];

/** ویجت‌های داشبورد نشست نماینده: لیست کار روزانه، وظایف، تقویم و یادآوری، کارتابل تأیید، پیام‌های نخوانده. */
export const AGENT_DASHBOARD_WIDGETS = new Set(['daily-checklist', 'tasks', 'calendar', 'approvals', 'messenger-unread']);

export function isAllowedForAgentSession(method: string, path: string): boolean {
  const p = path.split('?')[0]!.replace(/\/+$/, '');
  if (p.includes('..') || p.includes('//')) return false;
  if (DENIED_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`))) return false;
  if (ALLOWED_EXACT.has(`${method.toUpperCase()} ${p}`)) return true;
  return ALLOWED_PREFIXES.some((x) => p === x.replace(/\/$/, '') || p.startsWith(x.endsWith('/') ? x : `${x}/`));
}

/** صفحات وب مجاز نشست نماینده (برای همان فیلتر منو در فرانت؛ منبع حقیقت سرور است). */
export const AGENT_WEB_PREFIXES = ['/agents', '/dashboard', '/tasks', '/messenger', '/approvals', '/settings/profile', '/settings/notifications'];
