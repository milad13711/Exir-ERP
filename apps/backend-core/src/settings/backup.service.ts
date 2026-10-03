import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

const RETAIN_DAYS = 14;

export type DumpConnection = { dbHost: string; dbPort: number; dbName: string };

/**
 * آرگومان‌ها و env اجرای pg_dump — رمز فقط از راه PGPASSWORD می‌رود (نه روی
 * خط فرمان) تا در لیست پردازه‌ها دیده نشود. --clean --if-exists باعث می‌شود
 * بازیابی با psql روی یک دیتابیس موجود هم بدون خطا انجام شود.
 */
export function buildPgDumpInvocation(conn: DumpConnection, env: NodeJS.ProcessEnv = process.env) {
  const args = [
    '--host', conn.dbHost,
    '--port', String(conn.dbPort),
    '--username', env.TENANT_DB_ADMIN_USER ?? 'postgres',
    '--dbname', conn.dbName,
    '--no-owner',
    '--no-privileges',
    '--clean',
    '--if-exists',
  ];
  const childEnv: NodeJS.ProcessEnv = { ...env };
  if (env.TENANT_DB_ADMIN_PASSWORD) childEnv.PGPASSWORD = env.TENANT_DB_ADMIN_PASSWORD;
  return { args, env: childEnv };
}

/**
 * Off-site copy of the daily backup — every backup so far lived only on
 * the same host as the live data, so a full-disk/host failure loses both
 * at once. Dormant without config (same pattern as BAHA24_API_KEY/
 * EXIR_SMS_API_KEY elsewhere): with none of these three env vars set,
 * uploadOffsite() is a no-op and the feature ships inert, activated later
 * by adding credentials — no code change needed. Any S3-compatible
 * provider works (AWS S3, Liara/ArvanCloud object storage, Backblaze B2,
 * MinIO, ...) since BACKUP_S3_ENDPOINT is configurable, not hardcoded to AWS.
 */
function getS3Client(): { client: S3Client; bucket: string } | null {
  const bucket = process.env.BACKUP_S3_BUCKET;
  const accessKeyId = process.env.BACKUP_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.BACKUP_S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;

  const client = new S3Client({
    region: process.env.BACKUP_S3_REGION ?? 'us-east-1',
    endpoint: process.env.BACKUP_S3_ENDPOINT, // خالی یعنی AWS واقعی؛ برای سایر سرویس‌ها آدرس endpoint آن‌ها را بدهید
    forcePathStyle: process.env.BACKUP_S3_ENDPOINT ? true : undefined,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}

/** Prisma returns BigInt for a handful of columns (CrmDeal.value, JournalLine.debit/credit, BankStatementLine.amount) — native JSON.stringify throws on those, so every export/backup call site needs this replacer. */
export function stringifyWithBigInt(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v), space);
}

/**
 * Same export shape as the manual "دانلود پشتیبان" button
 * (`BackupController.export`) — extracted here so a daily cron can produce
 * the same file automatically, instead of backups only existing when
 * someone remembers to click the button. Writes to a bind-mounted host
 * directory (`BACKUP_DIR`, mounted as `./backups:/app/backups` in
 * docker-compose.on-premise.yml) so files survive a container recreate —
 * unlike the container's own filesystem, which docker discards.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger('BackupService');
  private readonly backupDir = process.env.BACKUP_DIR ?? '/app/backups';

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  /**
   * پشتیبان کامل و واقعی: pg_dump با خروجی SQL ساده که مستقیم در جریان gzip
   * می‌شود. برخلاف خروجی JSON (که فقط ۲۸ جدول را پوشش می‌داد و همه‌چیز را
   * در حافظه‌ی سرور نگه می‌داشت) این مسیر همه‌ی جدول‌های همه‌ی ماژول‌ها را
   * شامل می‌شود، سریع‌تر است و حجم حافظه‌اش مستقل از اندازه‌ی داده است.
   * بازیابی: gunzip -c backup.sql.gz | psql <db>
   */
  async streamTenantDump(conn: DumpConnection, out: Writable): Promise<void> {
    const { args, env } = buildPgDumpInvocation(conn);
    const child = spawn('pg_dump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 4000) stderr += chunk.toString();
    });
    const exited = new Promise<void>((resolve, reject) => {
      child.on('error', (err) => reject(new Error(`اجرای pg_dump ممکن نشد: ${err.message}`)));
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`pg_dump با کد ${code} متوقف شد: ${stderr.trim()}`))));
    });
    // اگر pg_dump وسط کار شکست بخورد، pipeline هم باید شکست بخورد تا فایل ناقص «موفق» نشان داده نشود.
    await Promise.all([pipeline(child.stdout, createGzip(), out), exited]);
  }

  async getTenantConnection(tenantId: string): Promise<DumpConnection> {
    const tenant = await this.controlDb.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return { dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName };
  }

  async buildExportPayload(db: TenantPrismaClient, tenantId: string) {
    const [
      users,
      roles,
      userRoles,
      modulePermissions,
      moduleSettings,
      crmContacts,
      crmDeals,
      crmActivities,
      products,
      warehouses,
      stockMovements,
      salesInvoices,
      salesQuotations,
      salesReturns,
      purchaseOrders,
      purchaseReturns,
      checks,
      accounts,
      journalEntries,
      currencies,
      budgets,
      fixedAssets,
      recurringInvoiceTemplates,
      bankStatementLines,
      employees,
      payrollSlips,
      tasks,
      attachments,
    ] = await Promise.all([
      db.user.findMany(),
      db.role.findMany(),
      db.userRole.findMany(),
      db.modulePermission.findMany(),
      db.moduleSetting.findMany(),
      db.crmContact.findMany(),
      db.crmDeal.findMany(),
      db.crmActivity.findMany(),
      db.product.findMany(),
      db.warehouse.findMany(),
      db.stockMovement.findMany(),
      db.salesInvoice.findMany({ include: { lines: true, payments: true } }),
      db.salesQuotation.findMany({ include: { lines: true } }),
      db.salesReturn.findMany({ include: { lines: true } }),
      db.purchaseOrder.findMany({ include: { lines: true, payments: true } }),
      db.purchaseReturn.findMany({ include: { lines: true } }),
      db.check.findMany(),
      db.account.findMany(),
      db.journalEntry.findMany({ include: { lines: true } }),
      db.currency.findMany(),
      db.budget.findMany({ include: { lines: true } }),
      db.fixedAsset.findMany(),
      db.recurringInvoiceTemplate.findMany({ include: { lines: true } }),
      db.bankStatementLine.findMany(),
      db.employee.findMany(),
      db.payrollSlip.findMany(),
      db.task.findMany(),
      db.attachment.findMany(),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      tenantId,
      data: {
        users,
        roles,
        userRoles,
        modulePermissions,
        moduleSettings,
        crmContacts,
        crmDeals,
        crmActivities,
        products,
        warehouses,
        stockMovements,
        salesInvoices,
        salesQuotations,
        salesReturns,
        purchaseOrders,
        purchaseReturns,
        checks,
        accounts,
        journalEntries,
        currencies,
        budgets,
        fixedAssets,
        recurringInvoiceTemplates,
        bankStatementLines,
        employees,
        payrollSlips,
        tasks,
        attachments,
      },
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyBackups(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    this.logger.log(`Running daily backup for ${tenants.length} tenant(s)...`);
    for (const tenant of tenants) {
      try {
        await this.backupOneTenant(tenant.id, tenant.slug, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Backup failed for tenant "${tenant.slug}" (${tenant.id}): ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async backupOneTenant(
    _tenantId: string,
    slug: string,
    dbHost: string,
    dbPort: number,
    dbName: string,
  ): Promise<void> {
    const tenantDir = join(this.backupDir, slug);
    await mkdir(tenantDir, { recursive: true });
    const fileName = `${new Date().toISOString().slice(0, 10)}.sql.gz`;
    const filePath = join(tenantDir, fileName);

    try {
      await this.streamTenantDump({ dbHost, dbPort, dbName }, createWriteStream(filePath));
    } catch (err) {
      await unlink(filePath).catch(() => {}); // فایل نیمه‌کاره نباید به‌عنوان بکاپ سالم بماند
      throw err;
    }

    await this.pruneOldBackups(tenantDir);
    this.logger.log(`Backup written for tenant "${slug}": ${fileName}`);

    await this.uploadOffsite(slug, fileName, await readFile(filePath));
  }

  private async uploadOffsite(slug: string, fileName: string, body: Buffer): Promise<void> {
    const s3 = getS3Client();
    if (!s3) return; // بدون تنظیم BACKUP_S3_* — این ماژول فعلاً غیرفعال است، نه خطا

    try {
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: `${slug}/${fileName}`,
          Body: body,
          ContentType: 'application/gzip',
        }),
      );
      this.logger.log(`Backup uploaded off-site for tenant "${slug}": ${fileName}`);
    } catch (err) {
      // شکست آپلود خارج از سایت نباید کل بکاپ روزانه را متوقف کند — نسخه‌ی محلی هرحال نوشته شده
      this.logger.error(`Off-site backup upload failed for tenant "${slug}": ${err instanceof Error ? err.message : err}`);
    }
  }

  private async pruneOldBackups(tenantDir: string): Promise<void> {
    const cutoff = Date.now() - RETAIN_DAYS * 86_400_000;
    const files = await readdir(tenantDir);
    for (const file of files) {
      const dateMatch = /^(\d{4}-\d{2}-\d{2})\.(json|sql\.gz)$/.exec(file);
      if (!dateMatch) continue;
      const fileDate = new Date(dateMatch[1]).getTime();
      if (fileDate < cutoff) {
        await unlink(join(tenantDir, file)).catch(() => {});
      }
    }
  }
}
