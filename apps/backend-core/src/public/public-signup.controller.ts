import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PublicSignupService } from './public-signup.service.js';
import { RequestSignupOtpDto } from './dto/request-signup-otp.dto.js';
import { VerifySignupOtpDto } from './dto/verify-signup-otp.dto.js';
import { CreatePublicTenantDto } from './dto/create-public-tenant.dto.js';

/**
 * Unauthenticated by design — this is how a prospective customer becomes a
 * tenant. Every write here either goes through OTP proof-of-phone first
 * (otp/request → otp/verify → a signup-ticket JWT) or is a pure read, so
 * nothing here trusts client-supplied identity on its own.
 */
@Controller('public/signup')
export class PublicSignupController {
  constructor(private readonly signup: PublicSignupService) {}

  @Post('otp/request')
  requestOtp(@Body() dto: RequestSignupOtpDto) {
    return this.signup.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Body() dto: VerifySignupOtpDto) {
    return this.signup.verifyOtp(dto.phone, dto.code);
  }

  @Get('check-slug')
  async checkSlug(@Query('slug') slug: string) {
    return { available: await this.signup.checkSlugAvailable(slug) };
  }

  @Post()
  create(@Body() dto: CreatePublicTenantDto) {
    return this.signup.createTenant(dto);
  }
}
