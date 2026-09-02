import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { PrismaClient as TenantPrismaClient } from '../../generated/tenant-client/index.js';

const RETAIN_DAYS = 14;

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
    await writeFile(join(tenantDir, fileName), stringifyWithBigInt(payload), 'utf-8');

    await this.pruneOldBackups(tenantDir);
    this.logger.log(`Backup written for tenant "${slug}": ${fileName}`);
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
