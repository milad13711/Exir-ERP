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

export type CreateBookingInput = {
  eventId: string;
  ticketTypeId: string;
  buyerName: string;
  buyerPhone: string;
  attendees: Array<{ name: string; phone?: string }>;
};

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

  list(ctx: TenantRequestContext, filters: { status?: string } = {}) {
    return ctx.tenantDb.event.findMany({
      where: filters.status ? { status: filters.status as never } : {},
      include: EVENT_INCLUDE,
      orderBy: { startAt: 'desc' },
    });
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

  /** رزرو خام — چه از پنل (ثبت دستی/حضوری) و چه از فلوی عمومی، هر دو از همین یک مسیر رد می‌شوند تا منطق ظرفیت یک‌جا بماند. */
  async createBooking(ctx: TenantRequestContext, input: CreateBookingInput) {
    const [event, ticketType] = await Promise.all([
      ctx.tenantDb.event.findUnique({ where: { id: input.eventId } }),
      ctx.tenantDb.eventTicketType.findUnique({ where: { id: input.ticketTypeId } }),
    ]);
    if (!event || event.status !== 'PUBLISHED') throw new NotFoundException('این رویداد برای ثبت‌نام در دسترس نیست');
    if (!ticketType || ticketType.eventId !== event.id) throw new NotFoundException('این نوع بلیط یافت نشد');

    const now = new Date();
    if (event.registrationOpensAt && now < event.registrationOpensAt) throw new BadRequestException('ثبت‌نام هنوز شروع نشده است');
    if (event.registrationClosesAt && now > event.registrationClosesAt) throw new BadRequestException('مهلت ثبت‌نام به پایان رسیده است');
    if (now > event.endAt) throw new BadRequestException('این رویداد به پایان رسیده است');

    const quantity = input.attendees.length;
    if (quantity < 1) throw new BadRequestException('حداقل یک شرکت‌کننده لازم است');

    const [eventHeld, typeHeld] = await Promise.all([
      ctx.tenantDb.eventTicket.count({ where: { eventId: event.id, status: { in: [...HOLDING_TICKET_STATUSES] } } }),
      ctx.tenantDb.eventTicket.count({ where: { ticketTypeId: ticketType.id, status: { in: [...HOLDING_TICKET_STATUSES] } } }),
    ]);
    if (event.capacity != null && eventHeld + quantity > event.capacity) throw new ConflictException('ظرفیت این رویداد تکمیل شده است');
    if (ticketType.capacity != null && typeHeld + quantity > ticketType.capacity) throw new ConflictException('ظرفیت این نوع بلیط تکمیل شده است');

    const unitPrice = ticketType.price;
    const totalAmount = unitPrice * quantity;

    // بلیط‌ها همین‌جا (قبل از تأیید پرداخت) با وضعیت VALID ساخته می‌شوند تا
    // ظرفیت واقعاً نگه داشته شود؛ اگر پرداخت ناموفق/منقضی شد، cancelBooking
    // همین بلیط‌ها را باطل و ظرفیت را آزاد می‌کند. برای بلیط رایگان (مبلغ صفر)
    // رزرو بلافاصله PAID می‌شود و finalizeBookingPayment باید بلافاصله صدا شود.
    const booking = await ctx.tenantDb.eventBooking.create({
      data: {
        eventId: event.id,
        ticketTypeId: ticketType.id,
        buyerName: input.buyerName,
        buyerPhone: input.buyerPhone,
        quantity,
        unitPrice,
        totalAmount,
        status: totalAmount === 0 ? 'PAID' : 'PENDING_PAYMENT',
        tickets: {
          create: input.attendees.map((a) => ({
            eventId: event.id,
            ticketTypeId: ticketType.id,
            ticketCode: generateTicketCode(),
            attendeeName: a.name,
            attendeePhone: a.phone,
          })),
        },
      },
      include: { event: true, ticketType: true, tickets: true },
    });
    return booking;
  }

  private async resolveOrCreateContact(ctx: TenantRequestContext, name: string, phone: string) {
    const existing = await ctx.tenantDb.crmContact.findFirst({ where: { phone } });
    if (existing) return existing;
    return ctx.tenantDb.crmContact.create({ data: { name, phone, isCustomer: true, source: 'رویداد' } });
  }

  /**
   * پرداخت موفق شد (یا بلیط رایگان بود) — مخاطب پیدا/ساخته می‌شود، فاکتور
   * واقعی صادر می‌شود (فقط اگر مبلغ صفر نباشد)، و برای بلیط‌هایی که در
   * createBooking از قبل ساخته شده‌اند پیامک صدور بلیط ارسال می‌شود.
   */
  async finalizeBookingPayment(ctx: TenantRequestContext, bookingId: string, publicWebUrl: string) {
    const booking = await ctx.tenantDb.eventBooking.findUnique({
      where: { id: bookingId },
      include: { event: true, ticketType: true, tickets: true },
    });
    if (!booking) throw new NotFoundException('این رزرو یافت نشد');
    if (booking.paidAt) return booking; // قبلاً نهایی شده — idempotent

    const contact = await this.resolveOrCreateContact(ctx, booking.buyerName, booking.buyerPhone);

    let invoiceId: string | undefined;
    if (booking.totalAmount > 0) {
      const invoice = await this.invoices.create(ctx, {
        contactId: contact.id,
        notes: `بلیط رویداد «${booking.event.title}» — ${booking.quantity} عدد`,
        lines: [{ description: `بلیط ${booking.ticketType.name} — ${booking.event.title}`, quantity: booking.quantity, unitPrice: booking.unitPrice }],
      });
      invoiceId = invoice.id;
    }

    await ctx.tenantDb.eventBooking.update({
      where: { id: booking.id },
      data: { status: 'PAID', paidAt: new Date(), contactId: contact.id, invoiceId },
    });

    const tickets = booking.tickets;
    if (this.sms.isConfigured() && publicWebUrl) {
      for (const ticket of tickets) {
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

    return ctx.tenantDb.eventBooking.findUnique({ where: { id: booking.id }, include: { tickets: true } });
  }

  async cancelBooking(ctx: TenantRequestContext, id: string) {
    const booking = await ctx.tenantDb.eventBooking.findUnique({ where: { id } });
    if (!booking) throw new NotFoundException('این رزرو یافت نشد');
    if (booking.status === 'CANCELLED') return booking;
    await ctx.tenantDb.$transaction([
      ctx.tenantDb.eventTicket.updateMany({ where: { bookingId: id }, data: { status: 'CANCELLED' } }),
      ctx.tenantDb.eventBooking.update({ where: { id }, data: { status: 'CANCELLED' } }),
    ]);
    return ctx.tenantDb.eventBooking.findUnique({ where: { id } });
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
