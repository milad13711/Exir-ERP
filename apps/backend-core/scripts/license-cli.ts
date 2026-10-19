/**
 * CLI مدیریت لایسنس روی سرور لایسنس (مستقیم روی کنترل‌پلین؛ بدون نیاز به UI):
 *   npm run license:issue -- --org "شرکت نمونه" --modules crm,accounting --seats 25 --activations 1 [--expires 2027-03-20 | --perpetual] [--updates-until 2027-03-20] [--edition pro]
 *   npm run license:public-key           (kid و کلید عمومی کلید فعلی را چاپ می‌کند)
 *   npm run license:offline-token -- --key LIC-... --installation i-xxxxxxxx --days 365 --reason "air-gapped"
 * هر عملیات در جدول license_events ثبت می‌شود (actor=cli). کلید خصوصی هرگز چاپ نمی‌شود.
 * توجه: این اسکریپت با tsx اجرا می‌شود؛ فقط سرویس‌های بدون decorator-metadata (Prisma + crypto) استفاده می‌شوند.
 */
import 'dotenv/config';
import { PrismaClient } from '../generated/control-client/index.js';
import { createPublicKey } from 'node:crypto';
import { generateUniqueLicenseKey } from '../src/licensing/license-key.js';
import { loadSigningKeyFromEnv } from '../src/licensing/license-crypto.js';
import { issueOfflineTokenCore } from '../src/licensing/license-offline.js';

const args = new Map<string, string>();
const argv = process.argv.slice(2);
const cmd = argv[0];
for (let i = 1; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    args.set(k, v);
  }
}
const endOfDay = (d: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59+03:30` : d);

const db = new PrismaClient({ datasources: { db: { url: process.env.CONTROL_DATABASE_URL } } });

async function main() {
  const key = loadSigningKeyFromEnv();
  if (cmd === 'public-key') {
    if (!key) throw new Error('LICENSE_SIGNING_PRIVATE_KEY_FILE/PEM تنظیم نشده');
    console.log(`kid: ${key.kid}\n${createPublicKey(key.privateKey).export({ type: 'spki', format: 'pem' })}`);
    return;
  }
  if (cmd === 'issue') {
    const org = args.get('org');
    const modules = (args.get('modules') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!org || modules.length === 0) throw new Error('--org و --modules لازم است');
    const licenseKey = await generateUniqueLicenseKey(async (k) => !!(await db.license.findUnique({ where: { licenseKey: k } })));
    const lic = await db.license.create({
      data: {
        licenseKey,
        orgName: org,
        allowedModules: modules,
        seats: Number(args.get('seats') ?? 10),
        maxActivations: Number(args.get('activations') ?? 1),
        graceDays: Number(args.get('grace-days') ?? 7),
        edition: args.get('edition') ?? null,
        expiresAt: args.has('perpetual') || !args.has('expires') ? null : endOfDay(args.get('expires')!),
        updatesUntil: args.has('updates-until') ? endOfDay(args.get('updates-until')!) : null,
      },
    });
    await db.licenseEvent.create({ data: { kind: 'ADMIN', action: 'create', licenseId: lic.id, licenseKeyHint: licenseKey.slice(-8), actorLabel: 'cli', detail: { orgName: org } } });
    console.log(`Created license ${lic.id}\nLICENSE_KEY=${licenseKey}`);
    console.log('ماژول‌های وابسته (dependsOn) را در پنل ادمین ببینید؛ این CLI وابستگی‌ها را خودکار اضافه نمی‌کند.');
    return;
  }
  if (cmd === 'offline-token') {
    if (!key) throw new Error('کلید امضا تنظیم نشده');
    const licenseKey = args.get('key');
    const installationId = args.get('installation');
    if (!licenseKey || !installationId) throw new Error('--key و --installation لازم است');
    // همان منطق مشترک سرویس ادمین: اعتبارسنجی شناسه، سقف روز، وضعیت لایسنس و ظرفیت (قفل ردیف)
    const crl = await db.licenseSetting.findUnique({ where: { key: 'crl_version' } });
    const r = await issueOfflineTokenCore(db as never, key, {
      licenseKey,
      installationId,
      validityDays: Number(args.get('days') ?? 365),
      crlVersion: Number(crl?.value ?? 1),
    });
    await db.licenseEvent.create({ data: { kind: 'ADMIN', action: 'offline_token', licenseId: r.payload.licenseId, licenseKeyHint: licenseKey.slice(-8), actorLabel: 'cli', detail: { jti: r.payload.jti, installationId, reason: args.get('reason') ?? null } } });
    console.log(`LICENSE_TOKEN=${r.token}`);
    return;
  }
  console.error('Usage: license-cli.ts <issue|public-key|offline-token> [--options]');
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
