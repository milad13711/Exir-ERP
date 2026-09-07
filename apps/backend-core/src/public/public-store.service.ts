import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { StoreOrdersService } from '../online-store/store-orders.service.js';
import { currentStock } from '../warehouse/stock.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreateStoreOrderDto } from './dto/create-store-order.dto.js';
import type { TrackStoreEventDto } from './dto/track-store-event.dto.js';
import type { SubmitStoreReviewDto } from './dto/submit-store-review.dto.js';

type RatingInfo = { avgRating: number | null; reviewCount: number };

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

  private async ratingsByProduct(ctx: TenantRequestContext, productIds: string[]): Promise<Map<string, RatingInfo>> {
    if (productIds.length === 0) return new Map();
    const grouped = await ctx.tenantDb.storeReview.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, status: 'APPROVED' },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return new Map(grouped.map((g) => [g.productId, { avgRating: g._avg.rating, reviewCount: g._count.rating }]));
  }

  async listProducts(slug: string) {
    const ctx = await this.resolveCtx(slug);
    const products = await ctx.tenantDb.product.findMany({
      where: { isActive: true, isPubliclyListed: true },
      include: { movements: { select: { quantityDelta: true } } },
      orderBy: { name: 'asc' },
    });
    const ratings = await this.ratingsByProduct(ctx, products.map((p) => p.id));
    return products.map((p) => this.toPublicShape(p, ratings.get(p.id)));
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
    const [ratings, reviews] = await Promise.all([
      this.ratingsByProduct(ctx, [product.id]),
      ctx.tenantDb.storeReview.findMany({
        where: { productId: product.id, status: 'APPROVED' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, customerName: true, rating: true, comment: true, createdAt: true },
      }),
    ]);
    return { ...this.toPublicShape(product, ratings.get(product.id)), reviews };
  }

  private toPublicShape(
    p: {
      id: string;
      publicSlug: string | null;
      name: string;
      publicDescription: string | null;
      publicImages: string[];
      salePrice: number;
      publicCompareAtPrice: number | null;
      unit: string;
      category: string | null;
      reservedQty: number;
      createdAt: Date;
      movements: { quantityDelta: number }[];
    },
    rating: RatingInfo | undefined,
  ) {
    const available = Math.max(0, currentStock(p.movements) - p.reservedQty);
    const hasDiscount = p.publicCompareAtPrice != null && p.publicCompareAtPrice > p.salePrice;
    const discountPercent = hasDiscount ? Math.round((1 - p.salePrice / p.publicCompareAtPrice!) * 100) : null;
    return {
      id: p.id,
      slug: p.publicSlug,
      name: p.name,
      description: p.publicDescription,
      images: p.publicImages,
      price: p.salePrice,
      compareAtPrice: hasDiscount ? p.publicCompareAtPrice : null,
      discountPercent,
      unit: p.unit,
      category: p.category,
      createdAt: p.createdAt,
      inStock: available > 0,
      available,
      avgRating: rating?.avgRating ?? null,
      reviewCount: rating?.reviewCount ?? 0,
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

  /** ثبت‌شده با وضعیت PENDING — تا تننت آن را تأیید نکند در فروشگاه عمومی دیده نمی‌شود (جلوگیری از هرزنامه). */
  async submitReview(slug: string, productSlug: string, dto: SubmitStoreReviewDto) {
    const ctx = await this.resolveCtx(slug);
    const product = await ctx.tenantDb.product.findUnique({ where: { publicSlug: productSlug } });
    if (!product || !product.isActive || !product.isPubliclyListed) {
      throw new NotFoundException('این کالا یافت نشد');
    }
    await ctx.tenantDb.storeReview.create({
      data: {
        productId: product.id,
        customerName: dto.customerName,
        rating: dto.rating,
        comment: dto.comment,
      },
    });
    return { ok: true };
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
