import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { TenantSmsService } from '../sms/tenant-sms.service.js';
import { publicRef } from '../common/tenant-public-key.js';
import { renderFleetTemplate, DEFAULT_FLEET_SMS } from './shipments.service.js';

const OFFER_GAP_MS = 5 * 60 * 1000;

/**
 * هر دقیقه اجرا می‌شود: برای هر بار در وضعیت OFFERED، پیامک پیشنهاد را به
 * راننده‌ی بعدی — طبق ترتیب رتبه‌بندی و با فاصله‌ی ۵ دقیقه از آخرین ارسال —
 * می‌فرستد. اولین راننده بلافاصله در همان تیک اول ارسال می‌شود. به محض
 * پذیرش یک پیشنهاد (ShipmentsService.acceptOfferByToken)، بقیه‌ی پیشنهادهای
 * SCHEDULED/PENDING همان بار به EXPIRED تغییر می‌کنند، پس این کرون خودش را
 * دوباره روی آن بار اجرا نمی‌کند.
 */
@Injectable()
export class FleetOfferDispatchService {
  private readonly logger = new Logger('FleetOfferDispatchService');

  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly sms: TenantSmsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatch(): Promise<void> {
    const tenants = await this.controlDb.tenant.findMany({ where: { status: 'ACTIVE' } });
    for (const tenant of tenants) {
      const fleetModule = await this.controlDb.tenantModule.findFirst({
        where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'fleet' } },
      });
      if (!fleetModule) continue;
      try {
        await this.dispatchTenant(tenant.id, tenant.dbHost, tenant.dbPort, tenant.dbName, tenant.slug);
      } catch (err) {
        this.logger.error(`Fleet offer dispatch failed for tenant ${tenant.id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async dispatchTenant(tenantId: string, dbHost: string, dbPort: number, dbName: string, slug: string): Promise<void> {
    const tenantDb = this.tenantPrisma.forTenant({ dbHost, dbPort, dbName });
    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');

    const shipments = await tenantDb.shipment.findMany({
      where: { status: 'OFFERED' },
      include: { offers: { orderBy: { rank: 'asc' }, include: { driver: { select: { id: true, name: true, phone: true } } } } },
    });
    if (shipments.length === 0) return;

    const smsRow = await tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'fleet', key: 'sms' } } });
    const smsSettings = { ...DEFAULT_FLEET_SMS, ...((smsRow?.value as Partial<typeof DEFAULT_FLEET_SMS>) ?? {}) };
    if (!smsSettings.enabled) return;

    for (const shipment of shipments) {
      const nextScheduled = shipment.offers.find((o) => o.status === 'SCHEDULED');
      if (!nextScheduled) continue;

      const lastSentAt = shipment.offers
        .filter((o) => o.sentAt)
        .map((o) => o.sentAt!.getTime())
        .sort((a, b) => b - a)[0];

      const shouldSend = lastSentAt === undefined || Date.now() - lastSentAt >= OFFER_GAP_MS;
      if (!shouldSend) continue;

      const offerUrl = `${publicWebUrl}/fleet/offer/${publicRef(slug)}/${nextScheduled.publicToken}`;
      const pickup = shipment.pickupAt.toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
      const message = renderFleetTemplate(smsSettings.offerDispatchTemplate, {
        cargoType: shipment.cargoType,
        quantity: `${shipment.quantity}${shipment.unit ? ' ' + shipment.unit : ''}`,
        deliveryAddress: shipment.deliveryAddress,
        pickup,
        link: offerUrl,
      });

      await this.sms.sendSms({ tenantId, tenantDb }, nextScheduled.driver.phone, message);
      await tenantDb.shipmentOffer.update({ where: { id: nextScheduled.id }, data: { status: 'PENDING', sentAt: new Date() } });
    }
  }
}
