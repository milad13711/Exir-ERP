import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantRequestContext } from '../common/request-context.js';
import { resolveTenantUserId } from '../common/resolve-tenant-user.js';
import { AutomationEngineService } from '../automation/automation-engine.service.js';
import { ExirSmsService } from '../sms/exir-sms.service.js';
import { InvoicesService } from '../sales/invoices.service.js';
import type { CreateEventDto } from './dto/create-event.dto.js';
import type { UpdateEventDto } from './dto/update-event.dto.js';
import type { CreateTicketTypeDto } from './dto/create-ticket-type.dto.js';
import type { UpdateTicketTypeDto } from './dto/update-ticket-type.dto.js';

const EVENT_INCLUDE = {
  ticketTypes: { orderBy: { sortOrder: 'asc' as const } },
  createdBy: { select: { id: true, name: true } },
};

const HOLDING_TICKET_STATUSES = ['VALID', 'CHECKED_IN'] as const;

function generateTicketCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars (0/O, 1/I)
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export type OrderItemInput = { ticketTypeId: string; attendees: Array<{ name: string; phone?: string }> };
export type CreateOrderInput = { eventId: string; buyerName: string; buyerPhone: string; items: OrderItemInput[] };

/** Reused by both EventsService (admin) and PublicEventsService (public landing) so remaining-capacity math lives in one place. */
export async function withRemainingCapacity<T extends { id: string; capacity: number | null; ticketTypes: Array<{ id: string; capacity: number | null }> }>(
  ctx: TenantRequestContext,
  event: T,
) {
  const [eventHeld, byType] = await Promise.all([
    ctx.tenantDb.eventTicket.count({ where: { eventId: event.id, status: { in: [...HOLDING_TICKET_STATUSES] } } }),
    ctx.tenantDb.eventTicket.groupBy({
      by: ['ticketTypeId'],
      where: { eventId: event.id, status: { in: [...HOLDING_TICKET_STATUSES] } },
      _count: { _all: true },
    }),
  ]);
  const soldByType = new Map(byType.map((r) => [r.ticketTypeId, r._count._all]));
  return {
    ...event,
    remainingCapacity: event.capacity != null ? Math.max(0, event.capacity - eventHeld) : null,
    ticketTypes: event.ticketTypes.map((t) => ({
      ...t,
      sold: soldByType.get(t.id) ?? 0,
      remaining: t.capacity != null ? Math.max(0, t.capacity - (soldByType.get(t.id) ?? 0)) : null,
    })),
  };
}

@Injectable()
export class EventsService {
  constructor(
    private readonly automation: AutomationEngineService,
    private readonly sms: ExirSmsService,
    private readonly invoices: InvoicesService,
  ) {}

  async list(ctx: TenantRequestContext, filters: { status?: string } = {}) {
    const events = await ctx.tenantDb.event.findMany({
      where: filters.status ? { status: filters.status as never } : {},
      include: EVENT_INCLUDE,
      orderBy: { startAt: 'desc' },
    });
    return Promise.all(events.map((e) => withRemainingCapacity(ctx, e)));
  }

  async detail(ctx: TenantRequestContext, id: string) {
    const event = await ctx.tenantDb.event.findUnique({ where: { id }, include: EVENT_INCLUDE });
    if (!event) throw new NotFoundException('این رویداد یافت نشد');
    return withRemainingCapacity(ctx, event);
  }

  async create(ctx: TenantRequestContext, dto: CreateEventDto) {
    const existingSlug = await ctx.tenantDb.event.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) throw new BadRequestException('این شناسه‌ی عمومی قبلاً استفاده شده است');

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      throw new BadRequestException('بازه‌ی زمانی رویداد نامعتبر است');
    }

    const createdByUserId = await resolveTenantUserId(ctx);
    return ctx.tenantDb.event.create({
      data: {
        slug: dto.slug,
        title: dto.title,
        description: dto.description,
        coverImage: dto.coverImage,
        venue: dto.venue,
        isOnline: dto.isOnline ?? false,
        onlineUrl: dto.onlineUrl,
        startAt,
        endAt,
        registrationOpensAt: dto.registrationOpensAt ? new Date(dto.registrationOpensAt) : undefined,
        registrationClosesAt: dto.registrationClosesAt ? new Date(dto.registrationClosesAt) : undefined,
        capacity: dto.capacity,
        category: dto.category,
        createdByUserId,
        ticketTypes: {
          create: dto.ticketTypes.map((t, i) => ({ name: t.name, price: t.price, capacity: t.capacity, sortOrder: t.sortOrder ?? i })),
        },
      },
      include: EVENT_INCLUDE,
    });
  }

  async update(ctx: TenantRequestContext, id: string, dto: UpdateEventDto) {
    const existing = await ctx.tenantDb.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این رویداد یافت نشد');

    return ctx.tenantDb.event.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        coverImage: dto.coverImage,
        venue: dto.venue,
        isOnline: dto.isOnline,
        onlineUrl: dto.onlineUrl,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        registrationOpensAt: dto.registrationOpensAt ? new Date(dto.registrationOpensAt) : undefined,
        registrationClosesAt: dto.registrationClosesAt ? new Date(dto.registrationClosesAt) : undefined,
        capacity: dto.capacity,
        category: dto.category,
      },
      include: EVENT_INCLUDE,
    });
  }

  async setStatus(ctx: TenantRequestContext, id: string, status: 'PUBLISHED' | 'CANCELLED' | 'DRAFT') {
    const existing = await ctx.tenantDb.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این رویداد یافت نشد');
    if (status === 'PUBLISHED' && existing.status === 'CANCELLED') {
      throw new ConflictException('رویداد لغوشده قابل انتشار مجدد نیست');
    }
    return ctx.tenantDb.event.update({ where: { id }, data: { status }, include: EVENT_INCLUDE });
  }

  async createTicketType(ctx: TenantRequestContext, eventId: string, dto: CreateTicketTypeDto) {
    await ctx.tenantDb.event.findUniqueOrThrow({ where: { id: eventId } });
    return ctx.tenantDb.eventTicketType.create({ data: { eventId, name: dto.name, price: dto.price, capacity: dto.capacity, sortOrder: dto.sortOrder ?? 0 } });
  }

  async updateTicketType(ctx: TenantRequestContext, id: string, dto: UpdateTicketTypeDto) {
    const existing = await ctx.tenantDb.eventTicketType.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('این نوع بلیط یافت نشد');
    return ctx.tenantDb.eventTicketType.update({ where: { id }, data: dto });
  }

  async deleteTicketType(ctx: TenantRequestContext, id: string) {
    const sold = await ctx.tenantDb.eventTicket.count({ where: { ticketTypeId: id, status: { in: [...HOLDING_TICKET_STATUSES] } } });
    if (sold > 0) throw new ConflictException('برای این نوع بلیط قبلاً بلیط صادر شده — قابل حذف نیست');
    await ctx.tenantDb.eventTicketType.delete({ where: { id } });
    return { ok: true };
  }

  listBookings(ctx: TenantRequestContext, eventId: string) {
    return ctx.tenantDb.eventBooking.findMany({
      where: { eventId },
      include: { ticketType: { select: { name: true } }, tickets: { select: { id: true, attendeeName: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  listTickets(ctx: TenantRequestContext, eventId: string) {
    return ctx.tenantDb.eventTicket.findMany({
      where: { eventId },
      include: { ticketType: { select: { name: true } }, booking: { select: { buyerName: true, buyerPhone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** برای نمایش تاریخچه‌ی بلیط‌های یک مخاطب در پروفایل CRM — همه‌ی رویدادها، نه فقط یکی. */
  listTicketsByContact(ctx: TenantRequestContext, contactId: string) {
    return ctx.tenantDb.eventTicket.findMany({
      where: { booking: { contactId } },
      include: { event: { select: { id: true, title: true, slug: true, startAt: true } }, ticketType: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * سفارش خرید بلیط — می‌تواند چند نوع بلیط را با هم شامل شود (مثلاً ۱ عادی +
   * ۲ ویژه در یک خرید)؛ همه با یک orderGroupId مشترک به‌عنوان چند EventBooking
   * ساخته می‌شوند تا هم منطق ظرفیت هر نوع بلیط جدا بماند و هم پرداخت/فاکتور
   * روی کل سفارش یک‌جا انجام شود. چه از پنل (ثبت دستی/حضوری) و چه از فلوی
   * عمومی، هر دو از همین یک مسیر رد می‌شوند.
   */
  async createOrder(ctx: TenantRequestContext, input: CreateOrderInput) {
    const event = await ctx.tenantDb.event.findUnique({ where: { id: input.eventId }, include: { ticketTypes: true } });
    if (!event || event.status !== 'PUBLISHED') throw new NotFoundException('این رویداد برای ثبت‌نام در دسترس نیست');
    if (input.items.length === 0) throw new BadRequestException('حداقل یک نوع بلیط انتخاب کنید');

    const now = new Date();
    if (event.registrationOpensAt && now < event.registrationOpensAt) throw new BadRequestException('ثبت‌نام هنوز شروع نشده است');
    if (event.registrationClosesAt && now > event.registrationClosesAt) throw new BadRequestException('مهلت ثبت‌نام به پایان رسیده است');
    if (now > event.endAt) throw new BadRequestException('این رویداد به پایان رسیده است');

    const ticketTypeById = new Map(event.ticketTypes.map((t) => [t.id, t]));
    let totalQuantity = 0;
    const quantityByType = new Map<string, number>();
    for (const item of input.items) {
      const tt = ticketTypeById.get(item.ticketTypeId);
      if (!tt) throw new NotFoundException('این نوع بلیط یافت نشد');
      if (item.attendees.length < 1) throw new BadRequestException('برای هر نوع بلیط حداقل یک شرکت‌کننده لازم است');
      totalQuantity += item.attendees.length;
      quantityByType.set(item.ticketTypeId, (quantityByType.get(item.ticketTypeId) ?? 0) + item.attendees.length);
    }

    const eventHeld = await ctx.tenantDb.eventTicket.count({ where: { eventId: event.id, status: { in: [...HOLDING_TICKET_STATUSES] } } });
    if (event.capacity != null && eventHeld + totalQuantity > event.capacity) throw new ConflictException('ظرفیت این رویداد تکمیل شده است');

    for (const [ticketTypeId, qty] of quantityByType) {
      const tt = ticketTypeById.get(ticketTypeId)!;
      if (tt.capacity == null) continue;
      const typeHeld = await ctx.tenantDb.eventTicket.count({ where: { ticketTypeId, status: { in: [...HOLDING_TICKET_STATUSES] } } });
      if (typeHeld + qty > tt.capacity) throw new ConflictException(`ظرفیت نوع بلیط «${tt.name}» تکمیل شده است`);
    }

    // بلیط‌ها همین‌جا (قبل از تأیید پرداخت) با وضعیت VALID ساخته می‌شوند تا
    // ظرفیت واقعاً نگه داشته شود؛ اگر پرداخت ناموفق/منقضی شد، cancelOrder
    // همین بلیط‌ها را باطل و ظرفیت را آزاد می‌کند.
    const orderGroupId = randomUUID();
    const bookings = [];
    for (const item of input.items) {
      const tt = ticketTypeById.get(item.ticketTypeId)!;
      const quantity = item.attendees.length;
      const booking = await ctx.tenantDb.eventBooking.create({
        data: {
          orderGroupId,
          eventId: event.id,
          ticketTypeId: tt.id,
          buyerName: input.buyerName,
          buyerPhone: input.buyerPhone,
          quantity,
          unitPrice: tt.price,
          totalAmount: tt.price * quantity,
          tickets: {
            create: item.attendees.map((a) => ({
              eventId: event.id,
              ticketTypeId: tt.id,
              ticketCode: generateTicketCode(),
              attendeeName: a.name,
              attendeePhone: a.phone,
            })),
          },
        },
        include: { tickets: true },
      });
      bookings.push(booking);
    }

    const totalAmount = bookings.reduce((sum, b) => sum + b.totalAmount, 0);
    return { orderGroupId, totalAmount, bookings };
  }

  private async resolveOrCreateContact(ctx: TenantRequestContext, name: string, phone: string) {
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone } });
    if (existing) return existing;
    return ctx.tenantDb.crmContact.create({ data: { name, phone, isCustomer: true, source: 'رویداد' } });
  }

  /**
   * پرداخت کل سفارش موفق شد (یا سفارش کاملاً رایگان بود) — مخاطب پیدا/ساخته
   * می‌شود، یک فاکتور واحد برای کل سفارش صادر می‌شود (هر نوع بلیط یک ردیف)،
   * و برای بلیط‌هایی که در createOrder از قبل ساخته شده‌اند پیامک صدور بلیط
   * ارسال می‌شود.
   */
  async finalizeOrderPayment(ctx: TenantRequestContext, orderGroupId: string, publicWebUrl: string) {
    const bookings = await ctx.tenantDb.eventBooking.findMany({
      where: { orderGroupId },
      include: { event: true, ticketType: true, tickets: true },
    });
    if (bookings.length === 0) throw new NotFoundException('این سفارش یافت نشد');
    if (bookings[0].paidAt) return bookings; // قبلاً نهایی شده — idempotent

    const first = bookings[0];
    const contact = await this.resolveOrCreateContact(ctx, first.buyerName, first.buyerPhone);
    const totalAmount = bookings.reduce((sum, b) => sum + b.totalAmount, 0);

    let invoiceId: string | undefined;
    if (totalAmount > 0) {
      const invoice = await this.invoices.create(ctx, {
        contactId: contact.id,
        notes: `بلیط رویداد «${first.event.title}»`,
        lines: bookings.map((b) => ({ description: `بلیط ${b.ticketType.name} — ${b.event.title}`, quantity: b.quantity, unitPrice: b.unitPrice })),
      });
      invoiceId = invoice.id;
    }

    await ctx.tenantDb.eventBooking.updateMany({
      where: { orderGroupId },
      data: { status: 'PAID', paidAt: new Date(), contactId: contact.id, invoiceId },
    });

    if (this.sms.isConfigured() && publicWebUrl) {
      for (const booking of bookings) {
        for (const ticket of booking.tickets) {
          const phone = ticket.attendeePhone || booking.buyerPhone;
          const url = `${publicWebUrl}/events/${ctx.tenantSlug}/ticket/${ticket.qrToken}`;
          await this.sms.sendSms(
            phone,
            `بلیط شما برای «${booking.event.title}» صادر شد. کد بلیط: ${ticket.ticketCode}\nمشاهده بلیط: ${url}`,
          );
          await this.automation.emit(ctx, 'events.ticket.issued', {
            eventTitle: booking.event.title,
            attendeeName: ticket.attendeeName,
            ticketCode: ticket.ticketCode,
          });
        }
      }
    }

    return ctx.tenantDb.eventBooking.findMany({ where: { orderGroupId }, include: { tickets: true } });
  }

  async cancelOrder(ctx: TenantRequestContext, orderGroupId: string) {
    const bookings = await ctx.tenantDb.eventBooking.findMany({ where: { orderGroupId }, select: { id: true, status: true } });
    if (bookings.length === 0 || bookings.every((b) => b.status === 'CANCELLED')) return;
    const bookingIds = bookings.map((b) => b.id);
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.eventTicket.updateMany({ where: { bookingId: { in: bookingIds } }, data: { status: 'CANCELLED' } }),
      ctx.tenantDb.eventBooking.updateMany({ where: { orderGroupId }, data: { status: 'CANCELLED' } }),
    ]);
  }

  async checkIn(ctx: TenantRequestContext, qrToken: string) {
    const ticket = await ctx.tenantDb.eventTicket.findUnique({
      where: { qrToken },
      include: { event: { select: { title: true } }, ticketType: { select: { name: true } } },
    });
    if (!ticket) throw new NotFoundException('این بلیط معتبر نیست');
    if (ticket.status === 'CANCELLED') throw new ConflictException('این بلیط باطل شده است');
    if (ticket.status === 'CHECKED_IN') {
      return { ...ticket, alreadyCheckedIn: true };
    }
    const checkedInByUserId = await resolveTenantUserId(ctx);
    const updated = await ctx.tenantDb.eventTicket.update({
      where: { id: ticket.id },
      data: { status: 'CHECKED_IN', checkedInAt: new Date(), checkedInByUserId },
      include: { event: { select: { title: true } }, ticketType: { select: { name: true } } },
    });
    return { ...updated, alreadyCheckedIn: false };
  }
}
