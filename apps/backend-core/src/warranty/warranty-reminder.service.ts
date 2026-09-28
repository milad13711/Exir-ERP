import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { WarrantyService } from './warranty.service.js';
import { SchedulableJobRegistryService, standardOffsetPresets } from '../scheduling/schedulable-job-registry.service.js';

const REMINDER_WINDOW_TOLERANCE_DAYS = 1; // برای اینکه اجرای روزانه‌ی کرون هیچ روزی را جا نیندازد

/**
 * هر روز روی دیتابیس تمام تننت‌های فعال: ابتدا گارانتی‌های فعالی که تاریخ
 * انقضایشان گذشته را منقضی علامت می‌زند، سپس به مشتریانی که گارانتی‌شان در
 * آستانه‌ی انقضا (طبق reminderDaysBeforeExpiry تنظیمات ماژول) است پیامک
 * یادآوری می‌فرستد — هر گارانتی حداکثر یک‌بار (expiryReminderSentAt ندارد؛
 * به‌جایش activatedAt+durationDays مبنای محاسبه‌ی روز هدف است، پس هر روز
 * فقط دقیقاً همان گارانتی‌هایی که امروز وارد بازه‌شان شده‌اند انتخاب می‌شوند).
 */
@Injectable()
export class WarrantyReminderService implements OnModuleInit {
  private readonly logger = new Logger('WarrantyReminderService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: TenantSmsService,
    private readonly warranty: WarrantyService,
    private readonly jobRegistry: SchedulableJobRegistryService,
  ) {}

  /** فقط ثبت در فهرست «زمان‌بندی ارسال خودکار» (تنظیمات) — رفتار واقعیِ این کرون هنوز طبق reminderDaysBeforeExpiry ثابت خودش اجرا می‌شود، نه این تنظیم. */
  onModuleInit(): void {
    this.jobRegistry.registerJob({
      code: 'warranty-expiry-reminder',
      label: 'یادآوری انقضای گارانتی',
      moduleCode: 'warranty',
      defaultConfig: standardOffsetPresets(9)[1], // ۳ روز قبل، ۰۹:۰۰
      allowedOffsets: standardOffsetPresets(9),
      behaviorWired: false,
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        const installed = await this.controlDb.tenantModule.findFirst({
          where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'warranty' } },
        });
        if (!installed) continue;

        const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
        const ctx = { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;

        await this.warranty.markExpired(ctx);
        await this.remindExpiringSoon(ctx);
      } catch (err) {
        this.logger.error(`Warranty reminder sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async remindExpiringSoon(ctx: TenantRequestContext): Promise<void> {
    const settings = await this.warranty.getGeneralSettings(ctx);
    if (!settings.reminderDaysBeforeExpiry) return;

    const smsSettings = await this.warranty.getSmsSettings(ctx);
    if (!smsSettings.enabled) return;

    const targetFrom = new Date(Date.now() + settings.reminderDaysBeforeExpiry * 86_400_000);
    const targetTo = new Date(targetFrom.getTime() + REMINDER_WINDOW_TOLERANCE_DAYS * 86_400_000);

    const expiringSoon = await ctx.tenantDb.warrantyCode.findMany({
      where: { status: 'ACTIVE', expiresAt: { gte: targetFrom, lt: targetTo }, activatedByPhone: { not: null } },
    });

    for (const warranty of expiringSoon) {
      const message = `مشتری گرامی ${warranty.activatedByName ?? ''}، گارانتی محصول شما با کد ${warranty.code} به‌زودی منقضی می‌شود. در صورت نیاز به خدمات پس از فروش، پیش از انقضا اقدام فرمایید.`;
      await this.sms.sendSms(ctx, warranty.activatedByPhone!, message);
    }
  }
}
