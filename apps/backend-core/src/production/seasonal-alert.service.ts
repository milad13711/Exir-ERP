import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { toJalaliYearMonth, JALALI_MONTHS } from '../common/jalali.js';
import { detectSeasonalSpikes, type ProductionHistoryEntry } from './seasonal-spike.js';

/**
 * Runs daily across every active tenant (production history lives per-
 * tenant, same reason ChecksReminderService can't be a single control-plane
 * query). Checks whether NEXT Jalali month has, historically, been a spike
 * month for any product this tenant makes — if so, gives whoever runs the
 * place a heads-up to line up the raw materials a month with lead time,
 * once per (product, target year+month) so it doesn't repeat every day
 * that month is still "next month".
 */
@Injectable()
export class SeasonalAlertService {
  private readonly logger = new Logger('SeasonalAlertService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkForUpcomingSpikes(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      try {
        await this.checkForTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName);
      } catch (err) {
        this.logger.error(`Seasonal alert sweep failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async checkForTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });

    const now = new Date();
    const { year: currentYear, month: currentMonth } = toJalaliYearMonth(now);
    const targetMonth = currentMonth === 12 ? 1 : currentMonth + 1;
    const targetYear = currentMonth === 12 ? currentYear + 1 : currentYear;

    const completedOrders = await tenantDb.productionOrder.findMany({
      where: { status: 'COMPLETED', actualEndAt: { not: null }, quantityProduced: { not: null } },
      select: { actualEndAt: true, quantityProduced: true, bom: { select: { outputProductId: true, outputProduct: { select: { name: true } }, lines: { select: { rawMaterialProductId: true, quantityPerBatch: true }, take: 5 }, batchOutputQty: true } } },
    });
    if (completedOrders.length === 0) return;

    const history: ProductionHistoryEntry[] = completedOrders.map((o) => {
      const { year, month } = toJalaliYearMonth(o.actualEndAt!);
      return {
        productId: o.bom.outputProductId,
        productName: o.bom.outputProduct.name,
        jalaliYear: year,
        jalaliMonth: month,
        quantityProduced: o.quantityProduced!,
      };
    });

    const spikes = detectSeasonalSpikes(history, targetMonth);
    if (spikes.length === 0) return;

    const owner = await tenantDb.user.findFirst({
      where: { roles: { some: { role: { name: 'مدیر سیستم' } } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) return;

    for (const spike of spikes) {
      const alertKey = `seasonal-spike-${spike.productId}-${targetYear}-${targetMonth}`;
      const existing = await tenantDb.task.findFirst({
        where: { relatedModule: 'production-forecast', relatedEntityId: alertKey },
      });
      if (existing) continue;

      const bom = await tenantDb.billOfMaterial.findFirst({
        where: { outputProductId: spike.productId, isActive: true },
        include: { lines: { include: { rawMaterial: { select: { name: true, unit: true } } } } },
      });
      const monthLabel = JALALI_MONTHS[targetMonth - 1];
      let materialsHint = '';
      if (bom) {
        const scale = spike.avgQuantityInMonth / bom.batchOutputQty;
        materialsHint = bom.lines
          .map((l) => `${l.rawMaterial.name} ~${Math.round(l.quantityPerBatch * scale)}${l.rawMaterial.unit}`)
          .join('، ');
      }

      await tenantDb.task.create({
        data: {
          title: `پیش‌بینی فصلی: تولید «${spike.productName}» در ${monthLabel} معمولاً افزایش می‌یابد`,
          assignedUserId: owner.id,
          relatedModule: 'production-forecast',
          relatedEntityId: alertKey,
          priority: 'MEDIUM',
        },
      });
      await this.notifications.notify(tenantDb, {
        userId: owner.id,
        type: 'production.seasonal_spike',
        title: `${monthLabel} معمولاً تولید «${spike.productName}» بیشتر می‌شود`,
        body: materialsHint
          ? `طبق سابقه‌ی ${spike.yearsOfData} سال گذشته، میانگین تولید این ماه ${spike.avgQuantityInMonth} است — پیشنهاد تأمین مواد اولیه: ${materialsHint}`
          : `طبق سابقه‌ی ${spike.yearsOfData} سال گذشته، میانگین تولید این ماه ${spike.avgQuantityInMonth} است.`,
        link: '/production',
      });
    }
  }
}
