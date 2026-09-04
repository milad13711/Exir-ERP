import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

const RETAIN_DAYS = 14;

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
    tenantId: string,
    slug: string,
    dbHost: string,
    dbPort: number,
    dbName: string,
  ): Promise<void> {
    const db = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const payload = await this.buildExportPayload(db, tenantId);

    const tenantDir = join(this.backupDir, slug);
    await mkdir(tenantDir, { recursive: true });
    const fileName = `${new Date().toISOString().slice(0, 10)}.json`;
    const body = stringifyWithBigInt(payload);
    await writeFile(join(tenantDir, fileName), body, 'utf-8');

    await this.pruneOldBackups(tenantDir);
    this.logger.log(`Backup written for tenant "${slug}": ${fileName}`);

    await this.uploadOffsite(slug, fileName, body);
  }

  private async uploadOffsite(slug: string, fileName: string, body: string): Promise<void> {
    const s3 = getS3Client();
    if (!s3) return; // بدون تنظیم BACKUP_S3_* — این ماژول فعلاً غیرفعال است، نه خطا

    try {
      await s3.client.send(
        new PutObjectCommand({
          Bucket: s3.bucket,
          Key: `${slug}/${fileName}`,
          Body: body,
          ContentType: 'application/json',
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
      const dateMatch = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
      if (!dateMatch) continue;
      const fileDate = new Date(dateMatch[1]).getTime();
      if (fileDate < cutoff) {
        await unlink(join(tenantDir, file)).catch(() => {});
      }
    }
  }
}
