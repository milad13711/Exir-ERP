import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { formatWhenFa } from './sessions.service.js';

const REMINDER_HOURS_BEFORE = 3;

/**
 * هر ساعت روی تمام تننت‌های دارای ماژول منتورینگ اجرا می‌شود: هر جلسه‌ی
 * زمان‌بندی‌شده‌ای که ورودی بازه‌ی ۳ ساعت مانده به شروع باشد، یک‌بار (و فقط
 * یک‌بار — reminderSentAt) به مشتری و مشاور پیامک یادآوری ارسال می‌کند.
 */
@Injectable()
export class MentoringReminderService {
  private readonly logger = new Logger('MentoringReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: ExirSmsService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    if (!this.sms.isConfigured()) return;
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const mentoringModule = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'mentoring' } },
      });
      if (!mentoringModule) continue;
      try {
        await this.sweepTenant(tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Mentoring reminder sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async sweepTenant(dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const now = new Date();
    const windowEnd = new Date(now.getTime() + REMINDER_HOURS_BEFORE * 3_600_000);

    const dueSessions = await tenantDb.mentoringSession.findMany({
      where: { status: 'SCHEDULED', reminderSentAt: null, scheduledAt: { gte: now, lte: windowEnd } },
      include: { engagement: { include: { contact: { select: { name: true, phone: true } }, advisor: { select: { name: true, phone: true } } } } },
    });

    for (const session of dueSessions) {
      const whenFa = formatWhenFa(session.scheduledAt);
      if (session.engagement.contact.phone) {
        await this.sms.sendSms(session.engagement.contact.phone, `یادآوری: جلسه‌ی «${session.engagement.title}» شما ساعتی دیگر، در ${whenFa} برگزار می‌شود.`);
      }
      if (session.engagement.advisor.phone) {
        await this.sms.sendSms(session.engagement.advisor.phone, `یادآوری: جلسه‌ی شما با ${session.engagement.contact.name} در ${whenFa} برگزار می‌شود.`);
      }
      await tenantDb.mentoringSession.update({ where: { id: session.id }, data: { reminderSentAt: new Date() } });
    }
  }
}
