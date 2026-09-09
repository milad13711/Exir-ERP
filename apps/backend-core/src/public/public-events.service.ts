import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { TenantPrismaService } from '../prisma/tenant-prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { EventsService, withRemainingCapacity } from '../events/events.service.js';
import { EventsQrService } from '../events/events-qr.service.js';
import { EventsTicketPdfService } from '../events/events-ticket-pdf.service.js';
import type { EventBookingTicketPayload } from '../auth/jwt-payload.type.js';
import type { TenantRequestContext } from '../common/request-context.js';
import type { CreatePublicEventOrderDto } from './dto/create-public-event-booking.dto.js';

const BOOKING_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Unauthenticated half of event ticket purchase — a visitor browsing the
 * public landing, booking a spot, paying, and getting a ticket, no tenant
 * login involved. Mirrors PublicBookingService's OTP -> short-lived-JWT
 * shape (real money moves here, unlike the OTP-free online-store order
 * flow), and reuses EventsService for the actual capacity-checked writes.
 */
@Injectable()
export class PublicEventsService {
  constructor(
    private readonly controlDb: ControlPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly auth: AuthService,
    private readonly events: EventsService,
    private readonly qr: EventsQrService,
    private readonly pdf: EventsTicketPdfService,
    private readonly jwt: JwtService,
  ) {}

  private async resolveTenantCtx(slug: string): Promise<TenantRequestContext> {
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELLED') {
      throw new NotFoundException('این لینک دیگر معتبر نیست');
    }
    const eventsModule = await this.controlDb.tenantModule.findFirst({
      where: { tenantId: tenant.id, status: { in: ['INSTALLED', 'TRIAL'] }, module: { code: 'events' } },
    });
    if (!eventsModule) throw new NotFoundException('فروش بلیط آنلاین برای این کسب‌وکار فعال نیست');
    const tenantDb = this.tenantPrisma.forTenant({ dbHost: tenant.dbHost, dbPort: tenant.dbPort, dbName: tenant.dbName });
    return { tenantId: tenant.id, tenantSlug: tenant.slug, tenantDb, auth: { role: 'OWNER' } } as unknown as TenantRequestContext;
  }

  async listEvents(slug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const events = await ctx.tenantDb.event.findMany({
      where: { status: 'PUBLISHED', endAt: { gte: new Date() } },
      include: { ticketTypes: { orderBy: { sortOrder: 'asc' } } },
      orderBy: { startAt: 'asc' },
    });
    return Promise.all(events.map((e) => withRemainingCapacity(ctx, e)));
  }

  async getEvent(slug: string, eventSlug: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const event = await ctx.tenantDb.event.findUnique({
      where: { slug: eventSlug },
      include: { ticketTypes: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!event || event.status !== 'PUBLISHED') throw new NotFoundException('این رویداد یافت نشد');
    return withRemainingCapacity(ctx, event);
  }

  async getCoverImage(slug: string, eventSlug: string): Promise<string | null> {
    const ctx = await this.resolveTenantCtx(slug);
    const event = await ctx.tenantDb.event.findUnique({ where: { slug: eventSlug }, select: { coverImage: true, status: true } });
    if (!event || event.status !== 'PUBLISHED') return null;
    return event.coverImage;
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

    const payload: EventBookingTicketPayload = { type: 'event_booking_ticket', phone, tenantSlug: slug };
    const bookingToken = await this.jwt.signAsync(payload, { expiresIn: BOOKING_TOKEN_TTL_SECONDS });
    return { bookingToken, expiresInSeconds: BOOKING_TOKEN_TTL_SECONDS };
  }

  private async resolveBookingPhone(slug: string, bookingToken: string): Promise<string> {
    let payload: EventBookingTicketPayload;
    try {
      payload = await this.jwt.verifyAsync<EventBookingTicketPayload>(bookingToken);
    } catch {
      throw new UnauthorizedException('نشست ثبت‌نام منقضی شده، شماره را دوباره تأیید کنید');
    }
    if (payload.type !== 'event_booking_ticket' || payload.tenantSlug !== slug) {
      throw new UnauthorizedException('نشست ثبت‌نام نامعتبر است');
    }
    return payload.phone;
  }

  async createOrder(slug: string, eventSlug: string, dto: CreatePublicEventOrderDto) {
    const ctx = await this.resolveTenantCtx(slug);
    const buyerPhone = await this.resolveBookingPhone(slug, dto.bookingToken);
    const event = await ctx.tenantDb.event.findUnique({ where: { slug: eventSlug } });
    if (!event) throw new NotFoundException('این رویداد یافت نشد');

    const order = await this.events.createOrder(ctx, {
      eventId: event.id,
      buyerName: dto.buyerName,
      buyerPhone,
      items: dto.items,
    });

    if (order.totalAmount === 0) {
      const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
      await this.events.finalizeOrderPayment(ctx, order.orderGroupId, publicWebUrl);
      return { orderGroupId: order.orderGroupId, requiresPayment: false };
    }
    return { orderGroupId: order.orderGroupId, requiresPayment: true, amount: order.totalAmount };
  }

  async getOrderStatus(slug: string, orderGroupId: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const bookings = await ctx.tenantDb.eventBooking.findMany({
      where: { orderGroupId },
      include: { tickets: { select: { qrToken: true, ticketCode: true, attendeeName: true } } },
    });
    if (bookings.length === 0) throw new NotFoundException('این سفارش یافت نشد');
    return {
      status: bookings[0].status,
      tickets: bookings.flatMap((b) => b.tickets),
    };
  }

  async getTicket(slug: string, qrToken: string) {
    const ctx = await this.resolveTenantCtx(slug);
    const ticket = await ctx.tenantDb.eventTicket.findUnique({
      where: { qrToken },
      include: { event: { select: { title: true, startAt: true, endAt: true, venue: true, isOnline: true, onlineUrl: true } }, ticketType: { select: { name: true } } },
    });
    if (!ticket) throw new NotFoundException('این بلیط یافت نشد');
    return ticket;
  }

  async getTicketQrPng(slug: string, qrToken: string): Promise<Buffer> {
    await this.getTicket(slug, qrToken);
    return this.qr.toPngBuffer(qrToken);
  }

  async getTicketPdf(slug: string, qrToken: string): Promise<Buffer> {
    const ctx = await this.resolveTenantCtx(slug);
    const ticket = await ctx.tenantDb.eventTicket.findUnique({
      where: { qrToken },
      include: { event: { select: { title: true, startAt: true, venue: true, isOnline: true } }, ticketType: { select: { name: true } } },
    });
    if (!ticket) throw new NotFoundException('این بلیط یافت نشد');
    const tenant = await this.controlDb.tenant.findUnique({ where: { slug } });
    return this.pdf.render(
      { ticketCode: ticket.ticketCode, qrToken: ticket.qrToken, attendeeName: ticket.attendeeName, ticketTypeName: ticket.ticketType.name, event: ticket.event },
      tenant?.name ?? '',
    );
  }
}
