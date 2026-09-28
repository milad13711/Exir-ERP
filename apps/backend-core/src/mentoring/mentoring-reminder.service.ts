import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { formatWhenFa } from './sessions.service.js';
import { SchedulableJobRegistryService, offsetPreset } from '../scheduling/schedulable-job-registry.service.js';

const REMINDER_HOURS_BEFORE = 3;

/**
 * هر ساعت روی تمام تننت‌های دارای ماژول منتورینگ اجرا می‌شود: هر جلسه‌ی
 * زمان‌بندی‌شده‌ای که ورودی بازه‌ی ۳ ساعت مانده به شروع باشد، یک‌بار (و فقط
 * یک‌بار — reminderSentAt) به مشتری و مشاور پیامک یادآوری ارسال می‌کند.
 */
@Injectable()
export class MentoringReminderService implements OnModuleInit {
  private readonly logger = new Logger('MentoringReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: TenantSmsService,
    private readonly jobRegistry: SchedulableJobRegistryService,
  ) {}

  /**
   * فقط ثبت در فهرست «زمان‌بندی ارسال خودکار» — این یادآوری بر اساس «چند
   * ساعت» مانده به جلسه است (REMINDER_HOURS_BEFORE)، نه افستِ روزانه، پس
   * فعلاً در قالب SAME_DAY نمایشی ثبت می‌شود و رفتار واقعی‌اش هنوز ثابت است.
   */
  onModuleInit(): void {
    this.jobRegistry.registerJob({
      code: 'mentoring-session-reminder',
      label: 'یادآوری جلسه‌ی منتورینگ',
      moduleCode: 'mentoring',
      defaultConfig: offsetPreset(0, 'SAME_DAY', 9, 0),
      allowedOffsets: [offsetPreset(0, 'SAME_DAY', 9, 0)],
      behaviorWired: false,
    });
  }

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const mentoringModule = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'mentoring' } },
      });
      if (!mentoringModule) continue;
      try {
        await this.sweepTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Mentoring reminder sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async sweepTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    // بدون پنل پیامکی متصل، یادآوری «ارسال‌شده» علامت نخورد تا بعد از اتصال هنوز ارسال شود
    if ((await this.sms.getConnection(tenantDb)).mode === 'NONE') return;
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 3_600_000);

    const dueSessions = await tenantDb.mentoringSession.findMany({
      where: { status: 'SCHEDULED', reminderSentAt: null, scheduledAt: { gte: now, lte: windowEnd } },
      include: { engagement: { include: { contact: { select: { name: true, phone: true } }, advisor: { select: { name: true, phone: true } } } } },
    });

    for (const session of dueSessions) {
      const whenFa = formatWhenFa(session.scheduledAt);
      if (session.engagement.contact.phone) {
        await this.sms.sendSms({ tenantId, tenantDb }, session.engagement.contact.phone, `یادآوری: جلسه‌ی «${session.engagement.title}» شما ساعتی دیگر، در ${whenFa} برگزار می‌شود.`);
      }
      if (session.engagement.advisor.phone) {
        await this.sms.sendSms({ tenantId, tenantDb }, session.engagement.advisor.phone, `یادآوری: جلسه‌ی شما با ${session.engagement.contact.name} در ${whenFa} برگزار می‌شود.`);
      }
      await tenantDb.mentoringSession.update({ where: { id: session.id }, data: { reminderSentAt: new Date() } });
    }
  }
}
