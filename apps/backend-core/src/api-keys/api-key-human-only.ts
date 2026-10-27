/**
 * مسیرهای مدیریتی/امنیتی که هیچ کلید API (قدیمی، فقط‌خواندنی یا کامل) نباید صدا بزند — وگرنه کلید با نقش OWNER و عبور از 2FA
 * می‌تواند دسترسی دائمی بسازد (دعوت کاربر، انتقال مالکیت، تغییر نقش/مجوز، وب‌هوک، سیاست sync، لایسنس، امنیت، کلیدها، تأیید MCP...).
 * این فهرست لایه‌ی دوم است؛ لایه‌ی اول: هر مسیر دارای @Roles برای کلید API بسته است مگر @ApiKeyAllowed و @HumanOnly صریح.
 */
const HUMAN_ONLY_PREFIXES = [
  'users', 'roles', 'permissions', 'settings', 'sync/policy', 'license', 'licenses', 'license-api', 'licensing', 'security',
  'auth', 'me', 'billing', 'platform', 'admin', 'modules', 'payment-gateway', 'onboarding', 'workspace', 'sms-panel', 'ai-actions',
  'internal', 'confidential-archive',
];

export function normalizeApiPath(rawUrl: string | undefined): string {
  const p = (rawUrl ?? '').split('?')[0].replace(/^\/+/, '').replace(/^api\//, '');
  return p.replace(/\/+$/, '');
}

export function isHumanOnlyPath(rawUrl: string | undefined): boolean {
  const p = normalizeApiPath(rawUrl);
  return HUMAN_ONLY_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}
