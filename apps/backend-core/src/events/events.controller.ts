import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { ModuleGuard } from '../common/guards/module.guard.js';
import { RequireModule } from '../common/decorators/require-module.decorator.js';
import { Ctx } from '../common/decorators/ctx.decorator.js';
import type { TenantRequestContext } from '../common/request-context.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { ControlPrismaService } from '../prisma/control-prisma.service.js';
import { EventsService } from './events.service.js';
import { EventsQrService } from './events-qr.service.js';
import { EventsPosterService, type PosterTemplateCode } from './events-poster.service.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto.js';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto.js';
import { CheckInTicketDto } from './dto/check-in-ticket.dto.js';
import { UpdateEventsSmsSettingsDto } from './dto/update-events-sms-settings.dto.js';

@Controller('events')
@UseGuards(JwtAuthGuard, ModuleGuard)
@RequireModule('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly qr: EventsQrService,
    private readonly poster: EventsPosterService,
    private readonly permissions: PermissionsService,
    private readonly controlDb: ControlPrismaService,
  ) {}

  @Get()
  async list(
    @Query('status') status: string | undefined,
    @Query('q') q: string | undefined,
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertViewAll(ctx, 'events');
    return this.events.list(ctx, { status, q });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'events');
    return this.events.detail(ctx, id);
  }

  @Post()
  async create(@Body() dto: CreateEventDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertCreate(ctx, 'events');
    return this.events.create(ctx, dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateEventDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'events');
    await this.permissions.assertViewAll(ctx, 'events'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.events.update(ctx, id, dto);
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'events');
    await this.permissions.assertViewAll(ctx, 'events'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.events.setStatus(ctx, id, 'PUBLISHED');
  }

  @Post(':id/unpublish')
  async unpublish(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'events');
    await this.permissions.assertViewAll(ctx, 'events'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.events.setStatus(ctx, id, 'DRAFT');
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'events');
    await this.permissions.assertViewAll(ctx, 'events'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.events.setStatus(ctx, id, 'CANCELLED');
  }

  @Post(':id/ticket-types')
  async createTicketType(@Param('id') id: string, @Body() dto: CreateTicketTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'events');
    await this.permissions.assertViewAll(ctx, 'events'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.events.createTicketType(ctx, id, dto);
  }

  @Patch('ticket-types/:ticketTypeId')
  async updateTicketType(@Param('ticketTypeId') ticketTypeId: string, @Body() dto: UpdateTicketTypeDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'events');
    await this.permissions.assertViewAll(ctx, 'events'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.events.updateTicketType(ctx, ticketTypeId, dto);
  }

  @Post('ticket-types/:ticketTypeId/delete')
  async deleteTicketType(@Param('ticketTypeId') ticketTypeId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertDelete(ctx, 'events');
    await this.permissions.assertViewAll(ctx, 'events'); // بدون «مشاهده‌ی همه» رکورد قابل‌دیدن نیست؛ پس عملیات روی شناسه‌اش هم مجاز نیست
    return this.events.deleteTicketType(ctx, ticketTypeId);
  }

  @Get(':id/bookings')
  async listBookings(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'events');
    return this.events.listBookings(ctx, id);
  }

  @Get(':id/tickets')
  async listTickets(@Param('id') id: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'events');
    return this.events.listTickets(ctx, id);
  }

  /** ثبت دستی حضوری (مثلاً فروش نقدی درِ ورودی) — می‌تواند چند نوع بلیط با هم داشته باشد؛ بلیط‌ها بلافاصله صادر می‌شوند، بدون گذر از درگاه پرداخت. */
  @Post(':id/bookings')
  async createManualBooking(
    @Param('id') id: string,
    @Body() dto: { buyerName: string; buyerPhone: string; items: Array<{ ticketTypeId: string; attendees: Array<{ name: string; phone?: string }> }> },
    @Ctx() ctx: TenantRequestContext,
  ) {
    await this.permissions.assertCreate(ctx, 'events');
    const order = await this.events.createOrder(ctx, { eventId: id, buyerName: dto.buyerName, buyerPhone: dto.buyerPhone, items: dto.items });
    const publicWebUrl = (process.env.WEB_PANEL_PUBLIC_URL ?? '').replace(/\/$/, '');
    return this.events.finalizeOrderPayment(ctx, order.orderGroupId, publicWebUrl);
  }

  @Post('check-in')
  async checkIn(@Body() dto: CheckInTicketDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'events');
    return this.events.checkIn(ctx, dto.qrToken);
  }

  /** برای نمایش تاریخچه‌ی بلیط‌های یک مخاطب در پروفایل CRM. */
  @Get('tickets/by-contact/:contactId')
  async listTicketsByContact(@Param('contactId') contactId: string, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertViewAll(ctx, 'events');
    return this.events.listTicketsByContact(ctx, contactId);
  }

  @Get('tickets/:qrToken/qr.png')
  async ticketQrImage(@Param('qrToken') qrToken: string, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertViewAll(ctx, 'events');
    const ticket = await ctx.tenantDb.eventTicket.findUnique({ where: { qrToken } });
    if (!ticket) {
      res.status(404).end();
      return;
    }
    const png = await this.qr.toPngBuffer(qrToken);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }

  @Get('settings/sms')
  async getSmsSettings(@Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertView(ctx, 'events');
    return this.events.getSmsSettings(ctx);
  }

  @Patch('settings/sms')
  async setSmsSettings(@Body() dto: UpdateEventsSmsSettingsDto, @Ctx() ctx: TenantRequestContext) {
    await this.permissions.assertEdit(ctx, 'events');
    return this.events.setSmsSettings(ctx, dto);
  }

  /** پوستر آماده‌ی انتشار در استوری/پست اینستاگرام یا واتس‌اپ — فقط تصویر می‌سازد، ارسال واقعی به شبکه‌ی اجتماعی وجود ندارد. */
  @Get(':id/poster')
  async getPoster(@Param('id') id: string, @Query('code') code: PosterTemplateCode | undefined, @Ctx() ctx: TenantRequestContext, @Res() res: Response) {
    await this.permissions.assertViewAll(ctx, 'events');
    const event = await ctx.tenantDb.event.findUnique({ where: { id } });
    if (!event) {
      res.status(404).end();
      return;
    }
    const tenant = await this.controlDb.tenant.findUnique({ where: { id: ctx.tenantId } });
    const png = await this.poster.render(code === 'story' ? 'story' : 'post-square', event, tenant?.themeColor ?? undefined);
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  }
}
