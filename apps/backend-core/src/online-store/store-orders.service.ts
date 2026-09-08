import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { FunnelService } from '../crm/funnel.service.js';
import { ensureDefaultWarehouse } from '../warehouse/default-warehouse.js';
import { currentStock } from '../warehouse/stock.js';
import type { CreateStoreOrderDto } from '../public/dto/create-store-order.dto.js';
import type { UpdateOrderStatusDto } from './dto/update-order-status.dto.js';

const ORDER_INCLUDE = { lines: true } as const;

const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED']);

/**
 * سفارش فروشگاه آنلاین موجودی را «رزرو» می‌کند (Product.reservedQty، نه یک
 * StockMovement واقعی) تا فروش بیشتر از ظرفیت واقعی انبار رخ ندهد — رزرو
 * وقتی سفارش لغو می‌شود آزاد، و وقتی ارسال می‌شود به کسر واقعی موجودی
 * (StockMovement از نوع ISSUE) تبدیل می‌شود. بررسی موجودی و رزرو هر دو
 * داخل یک تراکنش انجام می‌شوند تا پنجره‌ی رقابت بین دو سفارش هم‌زمان کوچک
 * بماند (نه صفر — این یک ساده‌سازی آگاهانه‌ی نسخه‌ی اول است، نه قفل ردیفی).
 */
@Injectable()
export class StoreOrdersService {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly funnel: FunnelService,
  ) {}

  async createOrder(ctx: TenantRequestContext, dto: CreateStoreOrderDto) {
    const productIds = [...new Set(dto.lines.map((l) => l.productId))];

    let createdNewContact = false;
    const order = await ctx.tenantDb.$transaction(async (tx) => {
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        include: { movements: { select: { quantityDelta: true } } },
      });
      const byId = new Map(products.map((p) => [p.id, p]));

      const missing = productIds.filter((id) => !byId.has(id));
      if (missing.length > 0) throw new BadRequestException('برخی کالاها یافت نشدند');

      let subtotal = 0;
      const lineData: { productId: string; productName: string; quantity: number; unitPrice: number; lineTotal: number }[] = [];
      for (const line of dto.lines) {
        const p = byId.get(line.productId)!;
        if (!p.isActive || !p.isPubliclyListed) {
          throw new BadRequestException(`کالای «${p.name}» دیگر در دسترس نیست`);
        }
        const available = currentStock(p.movements) - p.reservedQty;
        if (available < line.quantity) {
          throw new BadRequestException(`موجودی کافی برای «${p.name}» وجود ندارد (موجود: ${available})`);
        }
        const lineTotal = p.salePrice * line.quantity;
        subtotal += lineTotal;
        lineData.push({ productId: p.id, productName: p.name, quantity: line.quantity, unitPrice: p.salePrice, lineTotal });
      }

      let contact = dto.customerPhone ? await tx.crmContact.findFirst({ where: { phone: dto.customerPhone } }) : null;
      if (!contact) {
        contact = await tx.crmContact.create({
          data: {
            name: dto.customerName,
            phone: dto.customerPhone,
            address: dto.shippingAddress,
            isCustomer: true,
            source: 'فروشگاه آنلاین',
          },
        });
        createdNewContact = true;
      }

      const created = await tx.storeOrder.create({
        data: {
          contactId: contact.id,
          customerName: dto.customerName,
          customerPhone: dto.customerPhone,
          shippingAddress: dto.shippingAddress,
          notes: dto.notes,
          sessionToken: dto.sessionToken,
          subtotal,
          lines: { create: lineData },
        },
        include: ORDER_INCLUDE,
      });

      for (const line of lineData) {
        await tx.product.update({ where: { id: line.productId }, data: { reservedQty: { increment: line.quantity } } });
      }

      return created;
    });

    await this.automation.emit(ctx, 'online-store.order.placed', {
      orderNo: order.orderNo,
      customerName: order.customerName,
      subtotal: order.subtotal,
    });

    if (order.contactId) {
      if (createdNewContact) await this.funnel.initLead(ctx, order.contactId);
      await this.funnel.recordPurchase(ctx, order.contactId, order.subtotal, 'خرید مجدد از فروشگاه آنلاین');
    }

    return order;
  }

  async list(ctx: TenantRequestContext, status?: string) {
    return ctx.tenantDb.storeOrder.findMany({
      where: status ? { status: status as never } : {},
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const order = await ctx.tenantDb.storeOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    return order;
  }

  async updateStatus(ctx: TenantRequestContext, id: string, dto: UpdateOrderStatusDto) {
    const order = await this.detail(ctx, id);
    if (TERMINAL_STATUSES.has(order.status)) {
      throw new BadRequestException('این سفارش به وضعیت نهایی رسیده و دیگر قابل تغییر نیست');
    }

    const now = new Date();
    const data: Record<string, unknown> = { status: dto.status };
    if (dto.trackingCode) data.trackingCode = dto.trackingCode;
    if (dto.status === 'CONFIRMED') data.confirmedAt = now;
    if (dto.status === 'PACKED') data.packedAt = now;
    if (dto.status === 'SHIPPED') data.shippedAt = now;
    if (dto.status === 'DELIVERED') data.deliveredAt = now;
    if (dto.status === 'CANCELLED') data.cancelledAt = now;

    // خارج از تراکنش گرفته می‌شود چون ensureDefaultWarehouse با کلاینت کامل
    // Prisma کار می‌کند، نه با TransactionClient محدودشده‌ی $transaction.
    const warehouse = dto.status === 'SHIPPED' ? await ensureDefaultWarehouse(ctx.tenantDb) : null;

    await ctx.tenantDb.$transaction(async (tx) => {
      await tx.storeOrder.update({ where: { id }, data });

      if (dto.status === 'CANCELLED') {
        for (const line of order.lines) {
          await tx.product.update({ where: { id: line.productId }, data: { reservedQty: { decrement: line.quantity } } });
        }
      }

      if (dto.status === 'SHIPPED' && warehouse) {
        for (const line of order.lines) {
          await tx.stockMovement.create({
            data: {
              productId: line.productId,
              warehouseId: warehouse.id,
              type: 'ISSUE',
              quantityDelta: -line.quantity,
              reference: `سفارش فروشگاه آنلاین #${order.orderNo}`,
            },
          });
          await tx.product.update({ where: { id: line.productId }, data: { reservedQty: { decrement: line.quantity } } });
        }
      }
    });

    return this.detail(ctx, id);
  }
}
