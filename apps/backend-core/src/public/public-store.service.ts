import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { StoreOrdersService } from '../online-store/store-orders.service.js';
import { currentStock } from '../warehouse/stock.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreateStoreOrderDto } from './dto/create-store-order.dto.js';
import type { TrackStoreEventDto } from './dto/track-store-event.dto.js';

/**
 * بدون OTP — برخلاف رزرو نوبت که یک تراکنش مالی/زمانی حساس‌تر است، ثبت
 * سفارش فروشگاه (بدون پرداخت آنلاین) فقط یک درخواست است که تننت باید آن
 * را تأیید کند؛ اصطکاک اضافه‌ی OTP اینجا توجیه ندارد. توکن غیرقابل‌حدس
 * لازم هم نیست چون هیچ رکورد اختصاصی‌ای از طریق لینک باز نمی‌شود — همه‌چیز
 * از روی slug عمومی تننت در دسترس است، دقیقاً مثل صفحه‌ی محصولات هر فروشگاه.
 */
@Injectable()
export class PublicStoreService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly storeOrders: StoreOrdersService,
  ) {}

  private async resolveCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این فروشگاه در دسترس نیست');
    }
    const storeModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'online-store' } },
    });
    if (!storeModule) throw new NotFoundException('این فروشگاه در دسترس نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  async storeInfo(slug: string) {
    const ctx = await this.resolveCtx(slug);
    const [tenant, logoSetting] = await Promise.all([
      this.controlDb.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
      ctx.tenantDb.moduleSetting.findUnique({ where: { moduleCode_key: { moduleCode: 'general', key: 'logoUrl' } } }),
    ]);
    return {
      name: tenant.name,
      themeColor: tenant.themeColor,
      logoUrl: (logoSetting?.value as string | undefined) ?? null,
    };
  }

  async listProducts(slug: string) {
    const ctx = await this.resolveCtx(slug);
    const products = await ctx.tenantDb.product.findMany({
      where: { isActive: true, isPubliclyListed: true },
      include: { movements: { select: { quantityDelta: true } } },
      orderBy: { name: 'asc' },
    });
    return products.map((p) => this.toPublicShape(p));
  }

  async getProduct(slug: string, productSlug: string) {
    const ctx = await this.resolveCtx(slug);
    const product = await ctx.tenantDb.product.findUnique({
      where: { publicSlug: productSlug },
      include: { movements: { select: { quantityDelta: true } } },
    });
    if (!product || !product.isActive || !product.isPubliclyListed) {
      throw new NotFoundException('این کالا یافت نشد');
    }
    return this.toPublicShape(product);
  }

  private toPublicShape(p: {
    id: string;
    publicSlug: string | null;
    name: string;
    publicDescription: string | null;
    publicImages: string[];
    salePrice: number;
    unit: string;
    category: string | null;
    reservedQty: number;
    movements: { quantityDelta: number }[];
  }) {
    const available = Math.max(0, currentStock(p.movements) - p.reservedQty);
    return {
      id: p.id,
      slug: p.publicSlug,
      name: p.name,
      description: p.publicDescription,
      images: p.publicImages,
      price: p.salePrice,
      unit: p.unit,
      category: p.category,
      inStock: available > 0,
      available,
    };
  }

  async getProductImage(slug: string, productSlug: string, index: number): Promise<string | null> {
    const ctx = await this.resolveCtx(slug);
    const product = await ctx.tenantDb.product.findUnique({
      where: { publicSlug: productSlug },
      select: { publicImages: true, isPubliclyListed: true, isActive: true },
    });
    if (!product || !product.isActive || !product.isPubliclyListed) return null;
    return product.publicImages[index] ?? null;
  }

  async track(slug: string, dto: TrackStoreEventDto) {
    const ctx = await this.resolveCtx(slug);
    await ctx.tenantDb.storeAnalyticsEvent.create({
      data: {
        sessionToken: dto.sessionToken,
        type: dto.type,
        productId: dto.productId,
        meta: dto.meta as never,
      },
    });
    return { ok: true };
  }

  async placeOrder(slug: string, dto: CreateStoreOrderDto) {
    const ctx = await this.resolveCtx(slug);
    if (dto.lines.length === 0) throw new BadRequestException('سبد خرید خالی است');
    const order = await this.storeOrders.createOrder(ctx, dto);
    if (dto.sessionToken) {
      await ctx.tenantDb.storeAnalyticsEvent.create({
        data: { sessionToken: dto.sessionToken, type: 'ORDER_PLACED', meta: { orderNo: order.orderNo } },
      });
    }
    return { orderNo: order.orderNo, status: order.status };
  }

  /** فید Google Merchant/Meta Commerce Manager — https://support.google.com/merchants/answer/7052112 */
  async productFeedCsv(slug: string, baseUrl: string): Promise<string> {
    const ctx = await this.resolveCtx(slug);
    const products = await ctx.tenantDb.product.findMany({
      where: { isActive: true, isPubliclyListed: true, publicSlug: { not: null } },
      include: { movements: { select: { quantityDelta: true } } },
    });
    const header = 'id,title,description,link,image_link,price,availability,condition\n';
    const rows = products.map((p) => {
      const available = Math.max(0, currentStock(p.movements) - p.reservedQty);
      const link = `${baseUrl}/shop/${slug}/p/${p.publicSlug}`;
      const image = p.publicImages.length > 0 ? `${baseUrl}/api/public/store/${slug}/products/${p.publicSlug}/image/0` : '';
      const csvEscape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      return [
        csvEscape(p.id),
        csvEscape(p.name),
        csvEscape((p.publicDescription ?? p.name).slice(0, 5000)),
        csvEscape(link),
        csvEscape(image),
        csvEscape(`${p.salePrice * 10} IRR`), // تومان × ۱۰ = ریال، واحد رسمی ISO 4217 که فیدهای گوگل/متا می‌پذیرند
        available > 0 ? 'in stock' : 'out of stock',
        'new',
      ].join(',');
    });
    return header + rows.join('\n');
  }
}
