import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { faDate } from '../common/persian.js';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { contractPartyName } from './contracts.service.js';
import { SchedulableJobRegistryService, standardOffsetPresets } from '../scheduling/schedulable-job-registry.service.js';

/**
 * Runs once a day across every active tenant with the contracts module
 * installed:
 *   1. Auto-expires any ACTIVE contract whose endDate has passed and was
 *      never renewed — EXPIRED is a computed-at-sweep-time status, not
 *      something a user sets directly.
 *   2. Reminds about any ACTIVE contract entering its own
 *      renewalReminderDays window before endDate (in-app notification to
 *      whoever created it, plus the contracts.contract.expiring_soon
 *      automation trigger for tenants who've set up an SMS/task action).
 *      Each contract is only ever reminded once (reminderSentAt stamped).
 */
@Injectable()
export class ContractsReminderService implements OnModuleInit {
  private readonly logger = new Logger('ContractsReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationEngineService,
    private readonly jobRegistry: SchedulableJobRegistryService,
  ) {}

  /** فقط ثبت در فهرست «زمان‌بندی ارسال خودکار» — بازه‌ی واقعی از renewalReminderDays خودِ قرارداد می‌آید. */
  onModuleInit(): void {
    this.jobRegistry.registerJob({
      code: 'contract-renewal-reminder',
      label: 'یادآوری تمدید قرارداد',
      moduleCode: 'contracts',
      defaultConfig: standardOffsetPresets(9)[1],
      allowedOffsets: standardOffsetPresets(9),
      behaviorWired: false,
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const contractsModule = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'contracts' } },
      });
      if (!contractsModule) continue;
      try {
        await this.sweepTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Contract sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async sweepTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const now = new Date();

    await tenantDb.contract.updateMany({
      where: { status: 'ACTIVE', endDate: { lt: now } },
      data: { status: 'EXPIRED' },
    });

    // پنجره‌ی یادآوری هر قرارداد با خودش متفاوت است، پس با یک بازه‌ی
    // سخاوتمندانه (۹۰ روز) واکشی می‌کنیم و شرط دقیق را در حافظه اعمال می‌کنیم.
    const candidates = await tenantDb.contract.findMany({
      where: { status: 'ACTIVE', reminderSentAt: null, endDate: { lte: new Date(now.getTime() + 90 * 86_400_000) } },
      include: { contact: { select: { name: true } }, employee: { select: { fullName: true } } },
    });

    const dueNow = candidates.filter((c) => {
      const daysLeft = Math.ceil((c.endDate.getTime() - now.getTime()) / 86_400_000);
      return daysLeft <= c.renewalReminderDays;
    });
    if (dueNow.length === 0) return;

    const ctx = { tenantId, tenantSlug: '', tenantDb, auth: { role: 'OWNER' } } as unknown as import('../common/request-context.js').TenantRequestContext;

    for (const contract of dueNow) {
      const endDateFa = faDate(contract.endDate);

      const partyName = contractPartyName(contract);

      if (contract.createdByUserId) {
        await this.notifications.notify(tenantDb, {
          userId: contract.createdByUserId,
          type: 'contract.expiring_soon',
          title: `قرارداد «${contract.title}» رو به پایان است`,
          body: `قرارداد شماره ${contract.contractNo} با ${partyName} در تاریخ ${endDateFa} پایان می‌یابد.`,
          link: '/contracts',
        });
      }

      await this.automation.emit(ctx, 'contracts.contract.expiring_soon', {
        contractNo: contract.contractNo,
        title: contract.title,
        contactName: partyName,
        endDate: contract.endDate.toISOString(),
      });

      await tenantDb.contract.update({ where: { id: contract.id }, data: { reminderSentAt: new Date() } });
    }
  }
}
