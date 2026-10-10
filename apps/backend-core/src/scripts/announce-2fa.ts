/**
 * اعلان پیامکیِ «ورود دو مرحله‌ای برای مالک/مدیر اجباری می‌شود» — فقط از سمت پلتفرم، داخل کانتینر بک‌اند.
 *
 *   node dist/scripts/announce-2fa.js                 # پیش‌نمایش: فهرست گیرندگان + متن؛ هیچ پیامکی نمی‌رود
 *   node dist/scripts/announce-2fa.js --yes           # ارسال واقعی (حداکثر --limit نفر، پیش‌فرض ۵۰)
 *   node dist/scripts/announce-2fa.js --yes --limit 5 # فقط ۵ نفر اول (آزمایشی)
 *
 * قواعد ایمنی:
 *  - فقط OWNER/ADMIN فعالِ تننت‌های ACTIVE؛ هر شماره فقط یک‌بار حتی اگر عضو چند تننت باشد.
 *  - کسی که همین حالا ۲FA دارد پیامی نمی‌گیرد.
 *  - اگر در ۱۴ روز اخیر همین اعلان به همان شماره رفته (smsLog) دوباره نمی‌رود.
 *  - فقط شماره‌ی موبایل ایرانی معتبر؛ ارسال ترتیبی با فاصله؛ گزارش نتیجه بدون چاپ متن شماره‌ی کامل.
 */
import 'dotenv/config';
import { PrismaClient } from '../../generated/control-client/index.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';

const MARKER = 'ورود دو مرحله‌ای (Google Authenticator) برای مالک و مدیران اجباری می‌شود';
export const ANNOUNCE_2FA_MESSAGE = `اکسیر ERP: ${MARKER}. از تنظیمات > پروفایل در ۲ دقیقه فعال کنید؛ مهلت ۱۴ روز.`;
const DEDUPE_DAYS = 14;

function normalizeMobile(raw: string | null | undefined): string | null {
  const d = (raw ?? '').replace(/[۰-۹]/g, (c) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  const m = /^(?:98|0098)?0?(9\d{9})$/.exec(d);
  return m ? `0${m[1]}` : null;
}
const mask = (p: string) => `${p.slice(0, 4)}•••${p.slice(-3)}`;

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--yes');
  const li = args.indexOf('--limit');
  const limit = li >= 0 ? Math.max(1, Number(args[li + 1]) || 50) : 50;
  const db = new PrismaClient({ datasources: { db: { url: process.env.CONTROL_DATABASE_URL } } });
  try {
    const memberships = await db.tenantMembership.findMany({
      where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE', tenant: { status: 'ACTIVE' } },
      include: { globalUser: true, tenant: { select: { slug: true } } },
    });
    const byPhone = new Map<string, { name: string; tenants: Set<string>; enrolled: boolean }>();
    for (const m of memberships) {
      const phone = normalizeMobile(m.globalUser.phone);
      if (!phone) continue;
      const cur = byPhone.get(phone) ?? { name: m.globalUser.name ?? '', tenants: new Set<string>(), enrolled: false };
      cur.tenants.add(m.tenant.slug);
      if (m.globalUser.totpEnabledAt) cur.enrolled = true;
      byPhone.set(phone, cur);
    }
    const since = new Date(Date.now() - DEDUPE_DAYS * 86_400_000);
    const todo: Array<{ phone: string; name: string; tenants: string[] }> = [];
    let skippedEnrolled = 0;
    let skippedRecent = 0;
    for (const [phone, v] of byPhone) {
      if (v.enrolled) { skippedEnrolled++; continue; }
      const prior = await db.smsLog.count({ where: { phone, success: true, createdAt: { gte: since }, message: { contains: 'ورود دو مرحله‌ای' } } });
      if (prior > 0) { skippedRecent++; continue; }
      todo.push({ phone, name: v.name, tenants: [...v.tenants] });
    }
    console.log(`گیرندگان یکتا: ${byPhone.size} | ۲FA دارند (حذف): ${skippedEnrolled} | اعلان اخیر (حذف): ${skippedRecent} | برای ارسال: ${todo.length}`);
    console.log(`\nمتن (${ANNOUNCE_2FA_MESSAGE.length} نویسه):\n${ANNOUNCE_2FA_MESSAGE}\n`);
    for (const r of todo.slice(0, limit)) console.log(` - ${mask(r.phone)}  ${r.name}  [${r.tenants.join(', ')}]`);
    if (!send) { console.log(`\nپیش‌نمایش بود؛ چیزی ارسال نشد. برای ارسال: --yes`); return; }

    const sms = new ExirSmsService(db as never);
    if (!sms.isConfigured()) throw new Error('پنل پیامک پلتفرم پیکربندی نشده است');
    let ok = 0, failed = 0;
    for (const r of todo.slice(0, limit)) {
      const res = await sms.sendSms(r.phone, ANNOUNCE_2FA_MESSAGE, { source: 'PLATFORM' });
      if (res.success) ok++; else { failed++; console.log(` ! ناموفق: ${mask(r.phone)} — ${res.error}`); }
      await new Promise((r2) => setTimeout(r2, 1200));
    }
    console.log(`\nنتیجه: ${ok} موفق، ${failed} ناموفق (از ${Math.min(limit, todo.length)} نفر).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
