import { Body, Controller, Get, NotFoundException, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicEventsService } from './public-events.service.js';
import { RequestEventOtpDto } from './dto/request-event-otp.dto.js';
import { VerifyEventOtpDto } from './dto/verify-event-otp.dto.js';
import { CreatePublicEventOrderDto } from './dto/create-public-event-booking.dto.js';

@Controller('public/events/:slug')
export class PublicEventsController {
  constructor(private readonly events: PublicEventsService) {}

  @Get()
  list(@Param('slug') slug: string) {
    return this.events.listEvents(slug);
  }

  @Get(':eventSlug')
  detail(@Param('slug') slug: string, @Param('eventSlug') eventSlug: string) {
    return this.events.getEvent(slug, eventSlug);
  }

  /** تصویر کاور به‌صورت data URI ذخیره می‌شود؛ برای اینکه og:image/کارت رویداد یک URL واقعی داشته باشد، همینجا با Content-Type درست پخش می‌شود. */
  @Get(':eventSlug/image')
  async coverImage(@Param('slug') slug: string, @Param('eventSlug') eventSlug: string, @Res() res: Response) {
    const dataUri = await this.events.getCoverImage(slug, eventSlug);
    if (!dataUri) throw new NotFoundException('تصویر یافت نشد');
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
    if (!match) throw new NotFoundException('تصویر یافت نشد');
    const [, mimeType, base64] = match;
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(base64, 'base64'));
  }

  @Post('otp/request')
  requestOtp(@Param('slug') slug: string, @Body() dto: RequestEventOtpDto) {
    return this.events.requestOtp(slug, dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Param('slug') slug: string, @Body() dto: VerifyEventOtpDto) {
    return this.events.verifyOtp(slug, dto.phone, dto.code);
  }

  @Post(':eventSlug/bookings')
  createOrder(@Param('slug') slug: string, @Param('eventSlug') eventSlug: string, @Body() dto: CreatePublicEventOrderDto) {
    return this.events.createOrder(slug, eventSlug, dto);
  }

  @Get('bookings/:orderGroupId')
  orderStatus(@Param('slug') slug: string, @Param('orderGroupId') orderGroupId: string) {
    return this.events.getOrderStatus(slug, orderGroupId);
  }

  @Get('ticket/:qrToken')
  ticket(@Param('slug') slug: string, @Param('qrToken') qrToken: string) {
    return this.events.getTicket(slug, qrToken);
  }

  @Get('ticket/:qrToken/qr.png')
  async ticketQr(@Param('slug') slug: string, @Param('qrToken') qrToken: string, @Res() res: Response) {
    const png = await this.events.getTicketQrPng(slug, qrToken);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(png);
  }

  @Get('ticket/:qrToken/pdf')
  async ticketPdf(@Param('slug') slug: string, @Param('qrToken') qrToken: string, @Res() res: Response) {
    const pdf = await this.events.getTicketPdf(slug, qrToken);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="ticket.pdf"');
    res.send(pdf);
  }
}
