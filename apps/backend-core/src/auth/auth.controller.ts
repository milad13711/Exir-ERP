import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { RequestOtpDto } from './dto/request-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { SelectTenantDto } from './dto/select-tenant.dto.js';

@Controller('auth/otp')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('request')
  request(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('verify')
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.phone, dto.code, dto.tenantSlug);
  }

  /** گام دوم، فقط وقتی verify یک لیست انتخاب محیط کاری برگردانده باشد. */
  @Post('select-tenant')
  selectTenant(@Body() dto: SelectTenantDto) {
    return this.auth.selectTenant(dto.verificationToken, dto.tenantSlug);
  }
}
