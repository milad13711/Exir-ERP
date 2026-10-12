/**
 * گزارش فقط‌خواندنیِ حجم فایل‌های ذخیره‌شده در دیتابیس هر تننت (نشانه‌ی پُرشدن Postgres با data-URI).
 * هیچ داده‌ای حذف/بازنویسی نمی‌شود؛ فقط SELECT.
 *
 *   node dist/scripts/attachment-size-report.js [--tenant <slug>] [--top 10]
 *
 * نیاز: CONTROL_DATABASE_URL و TENANT_DB_ADMIN_USER/PASSWORD (مثل tenant-db-roles).
 * خروجی: برای هر تننت اندازه‌ی کل دیتابیس، جمع پیوست‌ها (generic_attachments)، و بزرگ‌ترین ردیف‌ها.
 */
import 'dotenv/config';
import { PrismaClient } from '../../generated/control-client/index.js';
import { adminClientConfig, withClient } from '../tenants/tenant-db-roles.js';

const mb = (n: number | string | null) => `${(Number(n ?? 0) / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const args = process.argv.slice(2);
  const ti = args.indexOf('--tenant');
  const onlySlug = ti >= 0 ? args[ti + 1] : undefined;
  const ni = args.indexOf('--top');
  const top = ni >= 0 ? Math.min(100, Math.max(1, Number(args[ni + 1]) || 10)) : 10;
  const control = new PrismaClient({ datasources: { db: { url: process.env.CONTROL_DATABASE_URL } } });
  try {
    const tenants = await control.tenant.findMany({
      where: onlySlug ? { slug: onlySlug } : {},
      select: { slug: true, dbHost: true, dbPort: true, dbName: true },
      orderBy: { slug: 'asc' },
    });
    let grand = 0;
    for (const t of tenants) {
      try {
        await withClient(adminClientConfig({ host: t.dbHost, port: t.dbPort }, t.dbName), async (c) => {
          const db = await c.query('SELECT pg_database_size(current_database()) AS size');
          const att = await c.query(
            `SELECT count(*)::int AS n, coalesce(sum(octet_length("fileUrl")),0)::bigint AS bytes,
                    count(*) FILTER (WHERE "fileUrl" LIKE 'data:%')::int AS inline
               FROM generic_attachments`,
          );
          const big = await c.query(
            `SELECT id, "entityType", title, octet_length("fileUrl") AS bytes, left("fileUrl", 30) AS head
               FROM generic_attachments ORDER BY octet_length("fileUrl") DESC LIMIT $1`,
            [top],
          );
          const a = att.rows[0];
          grand += Number(a.bytes);
          console.log(`\n== ${t.slug}  | کل دیتابیس: ${mb(db.rows[0].size)} | پیوست‌ها: ${a.n} ردیف (${a.inline} درون‌خطی) = ${mb(a.bytes)}`);
          for (const r of big.rows) console.log(`   ${mb(r.bytes).padStart(9)}  ${r.entityType}  ${String(r.title).slice(0, 40)}  [${String(r.head).split(';')[0]}]  ${r.id}`);
        });
      } catch (e) {
        console.log(`\n== ${t.slug}  ! ناموفق: ${(e as Error).message.split('\n')[0].slice(0, 120)}`);
      }
    }
    console.log(`\nجمع پیوست‌های همه‌ی تننت‌ها: ${mb(grand)}`);
  } finally {
    await control.$disconnect();
  }
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
