import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { Writable } from 'node:stream';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

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

/** Prisma returns BigInt for a handful of columns (CrmDeal.value, JournalLine.debit/credit, BankStatementLine.amount) — native JSON.stringify throws on those, so every export/backup call site needs this replacer. */
export function stringifyWithBigInt(value: unknown, space?: number): string {
  return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v), space);
}

/**
 * (Daily scheduled backups, encryption, retention, off-site upload and restore
 * verification now live in src/backup-dr/backup-dr.service.ts. This service keeps
 * the manual on-demand exports used by BackupController.)
 *
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
}
