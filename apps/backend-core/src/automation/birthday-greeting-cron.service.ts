import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { todayTehran } from '../daily-checklist/checklist-day.util.js';
import { AutomationEngineService } from './automation-engine.service.js';

/**
 * روزانه یک‌بار برای هر تننت فعال، پرسنل (hr.employee.birthday) و مخاطبین
 * CRM (crm.contact.birthday) را که امروز (بر اساس ماه+روز میلادیِ birthDate،
 * صرف‌نظر از سال) سالروز تولدشان است پیدا می‌کند و همان تریگرهای عمومی
 * اتوماسیون را شلیک می‌کند — خودِ این فایل هیچ ایده‌ای درباره‌ی «پیامک تبریک»
 * ندارد، فقط رویداد را اعلام می‌کند؛ تننت با یک قانون اتوماسیون معمولی
 * (تریگر → اقدام SEND_SMS) تصمیم می‌گیرد چه اتفاقی بیفتد (همان الگویی که
 * بقیه‌ی تریگرهای این کدبیس استفاده می‌کنند — نک: automation/trigger-registry.service.ts).
 *
 * dedup: هر (triggerCode, entityId, امروز) فقط یک‌بار شلیک می‌شود — نک:
 * AutomationTriggerFiring در schema.prisma، الگوبرداری‌شده از
 * DailyChecklistDayClose (daily-checklist/daily-checklist-cron.service.ts).
 * این جدول شبکه‌ی ایمنی است برای اجرای تصادفیِ دوباره‌ی همین کرون در همان
 * روز؛ خودِ @Cron فقط یک‌بار در روز (۹ صبح به وقت تهران) زمان‌بندی شده است.
 */
@Injectable()
export class BirthdayGreetingCronService {
  private readonly logger = new Logger('BirthdayGreetingCronService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly automation: AutomationEngineService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Asia/Tehran' })
  async sweep(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        await this.sweepTenant(tenant.id, tenant.slug, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Birthday greeting sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async sweepTenant(tenantId: string, tenantSlug: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const ctx: TenantRequestContext = {
      tenantId,
      tenantSlug,
      tenantDb,
      auth: { type: 'api_key', sub: 'system-birthday-greeting-cron', tenantId, role: 'OWNER' },
    };
    const today = todayTehran();
    const month = today.getUTCMonth() + 1;
    const day = today.getUTCDate();

    const employees = await tenantDb.employee.findMany({
      where: { birthDate: { not: null }, status: 'ACTIVE' },
      select: { id: true, fullName: true, employeeCode: true, userId: true, phone: true, birthDate: true },
    });
    for (const employee of employees) {
      if (!isBirthdayToday(employee.birthDate, month, day)) continue;
      const fired = await this.markFired(ctx, 'hr.employee.birthday', employee.id, today);
      if (!fired) continue;
      await this.automation.emit(ctx, 'hr.employee.birthday', {
        employeeName: employee.fullName,
        employeeCode: employee.employeeCode,
        employeeUserId: employee.userId,
        employeePhone: employee.phone,
      });
    }

    const contacts = await tenantDb.crmContact.findMany({
      where: { birthDate: { not: null } },
      select: { id: true, name: true, phone: true, birthDate: true },
    });
    for (const contact of contacts) {
      if (!isBirthdayToday(contact.birthDate, month, day)) continue;
      const fired = await this.markFired(ctx, 'crm.contact.birthday', contact.id, today);
      if (!fired) continue;
      await this.automation.emit(ctx, 'crm.contact.birthday', {
        contactId: contact.id,
        contactName: contact.name,
        contactPhone: contact.phone,
      });
    }
  }

  /** رزرو می‌کند که (triggerCode, entityId, today) قبلاً شلیک نشده — true یعنی حالا رزرو شد و می‌توان emit کرد، false یعنی امروز قبلاً شلیک شده. */
  private async markFired(ctx: TenantRequestContext, triggerCode: string, entityId: string, today: Date): Promise<boolean> {
    try {
      await ctx.tenantDb.automationTriggerFiring.create({ data: { triggerCode, entityId, firedOn: today } });
      return true;
    } catch {
      // نقض unique(triggerCode, entityId, firedOn) — یعنی امروز قبلاً برای همین موجودیت شلیک شده
      return false;
    }
  }
}

function isBirthdayToday(birthDate: Date | null, month: number, day: number): boolean {
  if (!birthDate) return false;
  return birthDate.getUTCMonth() + 1 === month && birthDate.getUTCDate() === day;
}
