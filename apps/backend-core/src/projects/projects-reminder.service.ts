import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';

/**
 * Runs once a day across every active tenant with the projects module
 * installed: flags any still-open project (PLANNING/ACTIVE/ON_HOLD) whose
 * endDate has passed and hasn't been flagged yet — a notification to the
 * manager (or creator, if no manager is set) plus the
 * projects.project.overdue automation trigger. Each project is only ever
 * flagged once (overdueNotifiedAt stamped) — a project can slip further
 * past its deadline without repeat spam; renaming/rescheduling the project
 * (which isn't built as a distinct action here) would be the way to reset it.
 */
@Injectable()
export class ProjectsReminderService {
  private readonly logger = new Logger('ProjectsReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationEngineService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const projectsModule = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'projects' } },
      });
      if (!projectsModule) continue;
      try {
        await this.sweepTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Project sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async sweepTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });

    const overdue = await tenantDb.project.findMany({
      where: {
        status: { in: ['PLANNING', 'ACTIVE', 'ON_HOLD'] },
        overdueNotifiedAt: null,
        endDate: { lt: new Date() },
      },
    });
    if (overdue.length === 0) return;

    const ctx = { tenantId, tenantSlug: '', tenantDb, auth: { role: 'OWNER' } } as unknown as import('../common/request-context.js').TenantRequestContext;

    for (const project of overdue) {
      const notifyUserId = project.managerUserId ?? project.createdByUserId;
      if (notifyUserId) {
        await this.notifications.notify(tenantDb, {
          userId: notifyUserId,
          type: 'project.overdue',
          title: `پروژه «${project.name}» از موعد گذشت`,
          body: `تاریخ پایان برنامه‌ریزی‌شده: ${project.endDate!.toLocaleDateString('fa-IR')}`,
          link: '/projects',
        });
      }

      await this.automation.emit(ctx, 'projects.project.overdue', {
        projectNo: project.projectNo,
        name: project.name,
        endDate: project.endDate!.toISOString(),
        managerUserId: project.managerUserId,
      });

      await tenantDb.project.update({ where: { id: project.id }, data: { overdueNotifiedAt: new Date() } });
    }
  }
}
