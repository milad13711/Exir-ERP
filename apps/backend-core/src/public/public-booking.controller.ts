import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PublicBookingService } from './public-booking.service.js';
import { RequestBookingOtpDto } from './dto/request-booking-otp.dto.js';
import { VerifyBookingOtpDto } from './dto/verify-booking-otp.dto.js';
import { CreatePublicAppointmentDto } from './dto/create-public-appointment.dto.js';

/**
 * Unauthenticated by design — the public-facing booking wizard a tenant
 * shares with its own customers (e.g. `/book/<slug>` in web-panel). Every
 * write is OTP-gated the same way public signup is (otp/request ->
 * otp/verify -> a booking-ticket JWT), so nothing here trusts a
 * client-supplied phone number on its own.
 */
@Controller('public/booking/:slug')
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  @Get('service-types')
  listServiceTypes(@Param('slug') slug: string) {
    return this.booking.listServiceTypes(slug);
  }

  @Get('providers')
  listProviders(@Param('slug') slug: string) {
    return this.booking.listProviders(slug);
  }

  @Post('otp/request')
  requestOtp(@Param('slug') slug: string, @Body() dto: RequestBookingOtpDto) {
    return this.booking.requestOtp(slug, dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Param('slug') slug: string, @Body() dto: VerifyBookingOtpDto) {
    return this.booking.verifyOtp(slug, dto.phone, dto.code);
  }

  @Post('appointments')
  createAppointment(@Param('slug') slug: string, @Body() dto: CreatePublicAppointmentDto) {
    return this.booking.createAppointment(slug, dto);
  }
}
