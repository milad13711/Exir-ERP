/**
 * بررسی‌های امنیتی پیکربندی هنگام بوت — fail-closed برای رازهای حیاتی.
 *  - JWT_SECRET: نبودن ← همیشه بوت متوقف. placeholder شناخته‌شده یا کمتر از ۱۶ نویسه ← توقف در production (در توسعه فقط هشدار).
 *    بین ۱۶ تا ۳۱ نویسه ← هشدار بلند (قفل نمی‌کنیم تا استقرار موجود با راز کوتاه‌تر ناگهان از کار نیفتد؛ در runbook چرخش توصیه شده).
 *  - سایر موارد فقط هشدار می‌دهند (production): OTP_DEV_ECHO، APP_SECRETS_KEY، CORS localhost، sandbox زرین‌پال، رمز DB تننت.
 * خروجی: فهرست هشدارها (برای لاگ و SecurityEvent). مقادیر راز هرگز چاپ نمی‌شوند.
 */
const PLACEHOLDERS = new Set([
  'secret', 'jwt_secret', 'changeme', 'change-me', 'change_me', 'dev-secret', 'devsecret', 'dev', 'test', 'password',
  'your-secret', 'your_secret', 'your-secret-here', 'replace-me', 'replace_me', 'supersecret', 'super-secret', 'default', '123456', 'secret123',
]);

export class InsecureConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsecureConfigError';
  }
}

export function assertSecureConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const warnings: string[] = [];
  const prod = env.NODE_ENV === 'production';

  const jwt = env.JWT_SECRET?.trim();
  if (!jwt) throw new InsecureConfigError('JWT_SECRET تنظیم نشده است؛ راه‌اندازی متوقف شد (با `openssl rand -hex 32` بسازید).');
  const placeholder =
    PLACEHOLDERS.has(jwt.toLowerCase()) ||
    /^(change|replace|your|example|sample|dev|test|todo|secret|password)[-_ ]/i.test(jwt) ||
    /change[-_ ]?me/i.test(jwt);
  const weak = jwt.length < 16 || new Set(jwt).size < 6;
  if (placeholder || weak) {
    const msg = placeholder ? 'JWT_SECRET یک مقدار پیش‌فرض/نمونه است' : 'JWT_SECRET بسیار ضعیف است (حداقل ۱۶ نویسه‌ی متنوع؛ توصیه: ۶۴ نویسه‌ی hex)';
    // production: قفل می‌شود. توسعه‌ی محلی (.env کپی‌شده از .env.example) فقط هشدار می‌گیرد.
    // ALLOW_WEAK_JWT_SECRET=true: دریچه‌ی موقت برای استقرار مرحله‌ای (اول راز را بچرخانید) — هشدار FATAL می‌دهد.
    if (prod && env.ALLOW_WEAK_JWT_SECRET !== 'true') throw new InsecureConfigError(`${msg}؛ راه‌اندازی متوقف شد.`);
    warnings.push(`${msg} (در production بوت متوقف می‌شود).`);
  } else if (jwt.length < 32) {
    warnings.push('JWT_SECRET کوتاه‌تر از ۳۲ نویسه است؛ در اولین فرصت با یک راز ۶۴ نویسه‌ای بچرخانید (runbook).');
  }

  if (prod) {
    if (env.OTP_DEV_ECHO === 'true') warnings.push('OTP_DEV_ECHO=true در production: اگر پنل پیامک پیکربندی نشود، کد ورود در پاسخ API برمی‌گردد.');
    if (!env.APP_SECRETS_KEY) warnings.push('APP_SECRETS_KEY تنظیم نشده: کلید درگاه پرداخت/پنل پیامک و رازهای 2FA نمی‌توانند رمزشده ذخیره شوند.');
    const cors = (env.CORS_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (cors.length === 0 || cors.some((o) => o === '*' || /localhost|127\.0\.0\.1/.test(o))) warnings.push('CORS_ORIGINS خالی/localhost/* است؛ فقط دامنه‌های واقعی پنل‌ها را بگذارید.');
    if ((env.ZARINPAL_SANDBOX ?? 'true') !== 'false' && env.ZARINPAL_MERCHANT_ID) warnings.push('ZARINPAL_SANDBOX فعال است در حالی که merchant تنظیم شده؛ پرداخت‌های واقعی انجام نمی‌شود.');
    if (!env.TENANT_DB_ADMIN_PASSWORD) warnings.push('TENANT_DB_ADMIN_PASSWORD خالی است: اتصال به دیتابیس تننت‌ها بدون رمز (trust auth). فقط برای شبکه‌ی کاملاً بسته مجاز است.');
    if (env.TENANT_DB_ADMIN_USER && env.TENANT_DB_ADMIN_USER === 'postgres') warnings.push('همه‌ی دیتابیس‌های تننت با سوپریوزر postgres باز می‌شوند (blast radius بالا) — پیشنهاد نقش جدا برای هر تننت در audit.');
    if (env.RATE_LIMIT_DISABLED === 'true') warnings.push('RATE_LIMIT_DISABLED=true: محدودکننده‌ی نرخ خاموش است.');
  }
  return warnings;
}
