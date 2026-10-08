/**
 * ابزار خط فرمان پاسخ به حادثه — روی سرور، داخل کانتینر بک‌اند (فقط آن به control DB دسترسی دارد).
 * وقتی پنل ادمین در دسترس نیست (مثلاً توکن ادمین لو رفته) هم کار می‌کند.
 *
 *   node dist/scripts/security-cli.js invalidate-all                 # خروج اجباری همه (epoch++)
 *   node dist/scripts/security-cli.js invalidate-tenant <slug>       # خروج اجباری یک تننت
 *   node dist/scripts/security-cli.js revoke-api-keys <slug>         # ابطال همه‌ی کلیدهای API یک تننت
 *   node dist/scripts/security-cli.js invalidate-admin <email>       # خروج اجباری یک کارشناس
 *   node dist/scripts/security-cli.js unlock-admin <email>           # رفع قفل ورود ناموفق
 *   node dist/scripts/security-cli.js reset-admin-2fa <email>        # غیرفعال‌کردن 2FA کارشناس (گم‌شدن گوشی+کدهای بازیابی)
 *
 * بعد از چرخش JWT_SECRET هم همه‌ی نشست‌ها می‌میرند، ولی این ابزار بدون ری‌استارت و بدون تغییر راز کار می‌کند.
 */
import 'dotenv/config';
import { PrismaClient } from '../../generated/control-client/index.js';

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const db = new PrismaClient({ datasources: { db: { url: process.env.CONTROL_DATABASE_URL } } });
  try {
    switch (cmd) {
      case 'invalidate-all': {
        const r = await db.securityState.upsert({ where: { id: 'global' }, create: { id: 'global', sessionEpoch: 1 }, update: { sessionEpoch: { increment: 1 } } });
        console.log(`OK: sessionEpoch=${r.sessionEpoch} — همه‌ی نشست‌ها باطل شد (حداکثر ۵ ثانیه تأخیر کش).`);
        break;
      }
      case 'invalidate-tenant': {
        if (!arg) throw new Error('slug الزامی است');
        const t = await db.tenant.update({ where: { slug: arg }, data: { tokenVersion: { increment: 1 } } });
        console.log(`OK: tenant ${t.slug} tokenVersion=${t.tokenVersion}`);
        break;
      }
      case 'revoke-api-keys': {
        if (!arg) throw new Error('slug الزامی است');
        const t = await db.tenant.findUniqueOrThrow({ where: { slug: arg } });
        const r = await db.apiKey.updateMany({ where: { tenantId: t.id, revokedAt: null }, data: { revokedAt: new Date() } });
        console.log(`OK: ${r.count} کلید API ابطال شد (کش درون‌حافظه‌ی ۳۰ثانیه‌ای بک‌اند را با ری‌استارت پاک کنید یا ۳۰ ثانیه صبر کنید).`);
        break;
      }
      case 'invalidate-admin': {
        if (!arg) throw new Error('email الزامی است');
        const a = await db.adminUser.update({ where: { email: arg }, data: { tokenVersion: { increment: 1 } } });
        console.log(`OK: admin ${a.email} tokenVersion=${a.tokenVersion}`);
        break;
      }
      case 'unlock-admin': {
        if (!arg) throw new Error('email الزامی است');
        await db.adminUser.update({ where: { email: arg }, data: { failedLoginCount: 0, lockedUntil: null } });
        console.log('OK: unlocked');
        break;
      }
      case 'reset-admin-2fa': {
        if (!arg) throw new Error('email الزامی است');
        await db.adminUser.update({
          where: { email: arg },
          data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null, recoveryCodeHashes: [], tokenVersion: { increment: 1 } },
        });
        console.log('OK: 2FA reset و نشست‌های این کارشناس باطل شد');
        break;
      }
      default:
        console.error('دستور ناشناخته. نمونه‌ها: invalidate-all | invalidate-tenant <slug> | revoke-api-keys <slug> | invalidate-admin <email> | unlock-admin <email> | reset-admin-2fa <email>');
        process.exit(1);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error('security-cli failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
