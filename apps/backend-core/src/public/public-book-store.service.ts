import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { BookStoreService, BOOK_ORDER_FORMATS, type BookOrderFormatCode } from '../book-store/book-store.service.js';
import type { BookOrderTicketPayload } from '../auth/jwt-payload.type.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreatePublicBookOrderDto } from './dto/create-public-book-order.dto.js';

const BOOKING_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Unauthenticated half of the single-product (book) purchase flow — mirrors
 * PublicEventsService's OTP -> short-lived-JWT -> createOrder shape, minus
 * capacity/tickets which don't apply to a plain product purchase.
 */
@Injectable()
export class PublicBookStoreService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly bookStore: BookStoreService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const bookStoreModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'book-store' } },
    });
    if (!bookStoreModule) throw new NotFoundException('فروش این محصول برای این کسب‌وکار فعال نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  getCatalog() {
    return Object.entries(BOOK_ORDER_FORMATS).map(([format, info]) => ({ format: format as BookOrderFormatCode, ...info }));
  }

  async requestOtp(slug: string, phone: string) {
    await this.resolveTenantCtx(slug);
    return this.auth.requestOtp(phone, 'BOOKING');
  }

  async verifyOtp(slug: string, phone: string, code: string): Promise<{ bookingToken: string; expiresInSeconds: number }> {
    await this.resolveTenantCtx(slug);

    const otp = await this.controlDb.otpCode.findFirst({
      where: { phone, purpose: 'BOOKING', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw new BadRequestException('کد تأیید منقضی شده است، دوباره درخواست دهید');
    if (otp.attempts >= 5) throw new BadRequestException('تعداد تلاش‌های مجاز به پایان رسید، کد جدید درخواست دهید');

    const isValid = await bcrypt.compare(code, otp.codeHash);
    if (!isValid) {
      await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new UnauthorizedException('کد تأیید نادرست است');
    }
    await this.controlDb.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

    const payload: BookOrderTicketPayload = { type: 'book_order_ticket', phone, tenantSlug: slug };
    const bookingToken = await this.jwt.signAsync(payload, { expiresIn: BOOKING_TOKEN_TTL_SECONDS });
    return { bookingToken, expiresInSeconds: BOOKING_TOKEN_TTL_SECONDS };
  }

  private async resolveOrderPhone(slug: string, bookingToken: string): Promise<string> {
    let payload: BookOrderTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<BookOrderTicketPayload>(bookingToken);
    } catch {
      throw new UnauthorizedException('نشست خرید منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'book_order_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست خرید نامعتبر است');
    }
    return payload.phone;
  }

  async createOrder(slug: string, dto: CreatePublicBookOrderDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const buyerPhone = await this.resolveOrderPhone(slug, dto.bookingToken);

    const order = await this.bookStore.createOrder(ctx, {
      format: dto.format,
      buyerName: dto.buyerName,
      buyerPhone,
      address: dto.address,
      postalCode: dto.postalCode,
    });
    return { orderId: order.id };
  }

  async getOrderStatus(slug: string, orderId: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const order = await ctx.tenantDb.bookOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('این سفارش یافت نشد');
    return { status: order.status, paidAt: order.paidAt };
  }
}
