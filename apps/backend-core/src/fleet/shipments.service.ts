import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { DriversService } from './drivers.service.js';
import type { CreateShipmentDto } from './dto/create-shipment.dto.js';

const SHIPMENT_INCLUDE = {
  contact: { select: { id: true, name: true, company: true, phone: true } },
  driver: { select: { id: true, name: true, phone: true, plateNumber: true, vehicleType: true } },
  createdBy: { select: { id: true, name: true } },
  offers: {
    orderBy: { rank: 'asc' as const },
    include: { driver: { select: { id: true, name: true, phone: true } } },
  },
  survey: true,
} as const;

export type MatchCandidate = {
  driver: { id: string; name: string; phone: string; capacityKg: number | null; serviceAreas: string[] };
  score: number;
  reasons: string[];
  averageRating: number | null;
};

@Injectable()
export class ShipmentsService {
  constructor(
    private readonly drivers: DriversService,
    private readonly sms: ExirSmsService,
    private readonly notifications: NotificationsService,
    private readonly automation: AutomationEngineService,
  ) {}

  list(ctx: TenantRequestContext, filters: { status?: string; contactId?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.contactId) where.contactId = filters.contactId;
    return ctx.tenantDb.shipment.findMany({
      where,
      include: SHIPMENT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const shipment = await ctx.tenantDb.shipment.findUnique({ where: { id }, include: SHIPMENT_INCLUDE });
    if (!shipment) throw new NotFoundException('بار یافت نشد');
    return shipment;
  }

  async create(ctx: TenantRequestContext, dto: CreateShipmentDto) {
    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.shipment.create({
      data: {
        sourceType: dto.sourceType ?? 'MANUAL',
        sourceStockMovementId: dto.sourceStockMovementId,
        sourceInvoiceId: dto.sourceInvoiceId,
        contactId: dto.contactId,
        cargoType: dto.cargoType,
        quantity: dto.quantity,
        unit: dto.unit,
        deliveryAddress: dto.deliveryAddress,
        region: dto.region,
        pickupAt: new Date(dto.pickupAt),
        createdByUserId,
      },
      include: SHIPMENT_INCLUDE,
    });
  }

  /** رتبه‌بندی راننده‌های فعال برای این بار — فقط پیشنهاد است، چیزی ذخیره نمی‌شود. */
  async matchCandidates(ctx: TenantRequestContext, shipmentId: string): Promise<MatchCandidate[]> {
    const shipment = await ctx.tenantDb.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('بار یافت نشد');

    const activeDrivers = await ctx.tenantDb.driver.findMany({ where: { isActive: true } });
    const scored = await Promise.all(
      activeDrivers.map(async (d) => {
        let score = 0;
        const reasons: string[] = [];

        if (d.capacityKg != null) {
          if (d.capacityKg >= shipment.quantity) {
            score += 30;
            reasons.push('ظرفیت کافی');
          } else {
            score -= 50;
            reasons.push('ظرفیت ناکافی برای این بار');
          }
        }

        if (shipment.region) {
          const covers = d.serviceAreas.some(
            (area) => area.trim() && (area.includes(shipment.region!) || shipment.region!.includes(area)),
          );
          if (covers) {
            score += 40;
            reasons.push('در محدوده‌ی سرویس‌دهی');
          }
        }

        const averageRating = await this.drivers.averageRating(ctx, d.id);
        if (averageRating != null) {
          score += averageRating * 6;
          reasons.push(`امتیاز ${averageRating} از نظرسنجی‌ها`);
        }

        return {
          driver: { id: d.id, name: d.name, phone: d.phone, capacityKg: d.capacityKg, serviceAreas: d.serviceAreas },
          score,
          reasons,
          averageRating,
        };
      }),
    );

    return scored.sort((a, b) => b.score - a.score);
  }

  private driverOfferMessage(shipment: { cargoType: string; quantity: number; unit: string | null; deliveryAddress: string; pickupAt: Date }, offerUrl: string): string {
    const pickup = shipment.pickupAt.toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' });
    return `پیشنهاد بار جدید:\nنوع: ${shipment.cargoType}\nمقدار: ${shipment.quantity}${shipment.unit ? ' ' + shipment.unit : ''}\nآدرس تحویل: ${shipment.deliveryAddress}\nزمان بارگیری: ${pickup}\nمشاهده و پذیرش: ${offerUrl}`;
  }

  /** ثبت لیست پیشنهاد راننده‌ها برای این بار — ترتیب دستی کاربر یا خروجی خودکار الگوریتم تطبیق. ارسال واقعی پیامک‌ها به‌ترتیب و با فاصله‌ی ۵ دقیقه‌ای، برعهده‌ی FleetOfferDispatchService (کرون) است. */
  async sendOffers(ctx: TenantRequestContext, shipmentId: string, driverIds: string[] | undefined) {
    const shipment = await ctx.tenantDb.shipment.findUnique({ where: { id: shipmentId } });
    if (!shipment) throw new NotFoundException('بار یافت نشد');
    if (shipment.status === 'ACCEPTED' || shipment.status === 'DELIVERED' || shipment.status === 'CANCELLED') {
      throw new ConflictException('این بار در وضعیتی نیست که بتوان برایش پیشنهاد ارسال کرد');
    }

    let orderedIds = driverIds;
    if (!orderedIds || orderedIds.length === 0) {
      const ranked = await this.matchCandidates(ctx, shipmentId);
      orderedIds = ranked.map((r) => r.driver.id);
    }
    if (orderedIds.length === 0) throw new BadRequestException('راننده‌ی فعالی برای پیشنهاد وجود ندارد');

    await ctx.tenantDb.shipmentOffer.deleteMany({ where: { shipmentId, status: { in: ['SCHEDULED', 'EXPIRED'] } } });
    await ctx.tenantDb.shipmentOffer.createMany({
      data: orderedIds.map((driverId, i) => ({ shipmentId, driverId, rank: i + 1 })),
    });
    await ctx.tenantDb.shipment.update({ where: { id: shipmentId }, data: { status: 'OFFERED' } });
    return this.detail(ctx, shipmentId);
  }

  /** پذیرش یک پیشنهاد از طریق لینک عمومی — اعتبار لینک همان توکن یکتای غیرقابل‌حدس است، نیازی به OTP نیست. */
  async acceptOfferByToken(ctx: TenantRequestContext, token: string) {
    const offer = await ctx.tenantDb.shipmentOffer.findUnique({
      where: { publicToken: token },
      include: { shipment: true, driver: true },
    });
    if (!offer) throw new NotFoundException('این لینک معتبر نیست');

    if (offer.status === 'ACCEPTED') return { status: 'accepted_by_you' as const, shipment: offer.shipment, driver: offer.driver };
    if (offer.shipment.status === 'ACCEPTED' || offer.shipment.status === 'CANCELLED') {
      return { status: 'taken_by_other' as const };
    }

    await ctx.tenantDb.shipmentOffer.update({
      where: { id: offer.id },
      data: { status: 'ACCEPTED', respondedAt: new Date(), sentAt: offer.sentAt ?? new Date() },
    });
    await ctx.tenantDb.shipmentOffer.updateMany({
      where: { shipmentId: offer.shipmentId, id: { not: offer.id }, status: { in: ['PENDING', 'SCHEDULED'] } },
      data: { status: 'EXPIRED' },
    });
    const shipment = await ctx.tenantDb.shipment.update({
      where: { id: offer.shipmentId },
      data: { status: 'ACCEPTED', driverId: offer.driverId, acceptedAt: new Date() },
      include: { createdBy: true },
    });

    if (shipment.createdBy) {
      const message = `راننده «${offer.driver.name}» بار شماره ${shipment.shipmentNo} را پذیرفت.\nتماس با راننده: ${offer.driver.phone}`;
      await this.sms.sendSms(shipment.createdBy.phone, message);
      await this.notifications.notify(ctx.tenantDb, {
        userId: shipment.createdBy.id,
        type: 'fleet.offer.accepted',
        title: `راننده برای بار #${shipment.shipmentNo} پیدا شد`,
        body: `${offer.driver.name} — ${offer.driver.phone}`,
        link: '/fleet',
      });
    }

    await this.automation.emit(ctx, 'fleet.shipment.offer_accepted', {
      shipmentNo: shipment.shipmentNo,
      driverName: offer.driver.name,
      driverPhone: offer.driver.phone,
    });

    return { status: 'accepted' as const, shipment, driver: offer.driver };
  }

  async viewOfferByToken(ctx: TenantRequestContext, token: string) {
    const offer = await ctx.tenantDb.shipmentOffer.findUnique({
      where: { publicToken: token },
      include: { shipment: true, driver: { select: { name: true } } },
    });
    if (!offer) throw new NotFoundException('این لینک معتبر نیست');

    if (offer.status === 'ACCEPTED') return { status: 'accepted_by_you' as const, shipment: offer.shipment };
    if (offer.shipment.status === 'ACCEPTED' || offer.status === 'EXPIRED') return { status: 'taken_by_other' as const };
    if (offer.shipment.status === 'CANCELLED') return { status: 'cancelled' as const };
    return { status: 'pending' as const, shipment: offer.shipment };
  }

  async cancel(ctx: TenantRequestContext, id: string) {
    const shipment = await ctx.tenantDb.shipment.findUnique({ where: { id } });
    if (!shipment) throw new NotFoundException('بار یافت نشد');
    if (shipment.status === 'DELIVERED') throw new ConflictException('بار تحویل‌شده قابل لغو نیست');
    await ctx.tenantDb.shipmentOffer.updateMany({
      where: { shipmentId: id, status: { in: ['PENDING', 'SCHEDULED'] } },
      data: { status: 'EXPIRED' },
    });
    return ctx.tenantDb.shipment.update({ where: { id }, data: { status: 'CANCELLED' }, include: SHIPMENT_INCLUDE });
  }

  /** تحویل بار — لینک نظرسنجی برای مشتری پیامک می‌شود (اگر شماره تماس در دسترس باشد). */
  async deliver(ctx: TenantRequestContext, id: string, publicWebUrl: string, tenantSlug: string) {
    const shipment = await ctx.tenantDb.shipment.findUnique({ where: { id }, include: { contact: true } });
    if (!shipment) throw new NotFoundException('بار یافت نشد');
    if (shipment.status !== 'ACCEPTED') throw new ConflictException('فقط بار پذیرفته‌شده توسط راننده قابل تحویل است');

    await ctx.tenantDb.shipment.update({ where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });

    const survey = await ctx.tenantDb.deliverySurvey.create({ data: { shipmentId: id } });
    if (shipment.contact?.phone) {
      const url = `${publicWebUrl}/survey/${tenantSlug}/${survey.publicToken}`;
      const message = `بار شماره ${shipment.shipmentNo} با موفقیت تحویل داده شد. نظر شما به ما کمک می‌کند: ${url}`;
      const result = await this.sms.sendSms(shipment.contact.phone, message);
      if (result.success) {
        await ctx.tenantDb.deliverySurvey.update({ where: { id: survey.id }, data: { sentAt: new Date() } });
      }
    }

    await this.automation.emit(ctx, 'fleet.shipment.delivered', {
      shipmentNo: shipment.shipmentNo,
      cargoType: shipment.cargoType,
    });

    return this.detail(ctx, id);
  }
}
