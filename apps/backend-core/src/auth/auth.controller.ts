import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { RequestOtpDto } from './dto/request-otp.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { SelectTenantDto } from './dto/select-tenant.dto.js';
import { TotpCodeDto, VerifyTotpLoginDto } from './dto/totp.dto.js';
import { twoFactorRequiredError, wouldBeRestrictedWithout2FA } from './tenant-two-factor-policy.js';
import { TenantTwoFactorService } from './tenant-two-factor.service.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { clientIp } from '../security/client-ip.js';

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

  /** گام دوم ورود وقتی کاربر 2FA (TOTP) فعال کرده و verify/select-tenant مقدار requiresTotp داده است. */
  @Post('verify-totp')
  verifyTotp(@Body() dto: VerifyTotpLoginDto, @Req() req: Request) {
    return this.auth.completeTotpLogin(dto.totpToken, dto.code, clientIp(req));
  }
}

/** مدیریت 2FA اختیاری توسط خود مالک/مدیر واردشده. */
@Controller('auth/2fa')
@UseGuards(JwtAuthGuard)
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TenantTwoFactorService,
    private readonly auth: AuthService,
  ) {}

  private who(req: Request) {
    const a = req.ctx!.auth;
    this.twoFactor.assertCanManage(a.role, a.type);
    return a.sub;
  }

  @Get('status')
  async status(@Req() req: Request) {
    const st = await this.twoFactor.status(this.who(req));
    return { ...st, policy: req.ctx!.twoFactor ?? null };
  }

  @Post('setup')
  setup(@Req() req: Request) {
    return this.twoFactor.beginSetup(this.who(req));
  }

  @Post('enable')
  async enable(@Body() dto: TotpCodeDto, @Req() req: Request) {
    const a = req.ctx!.auth;
    const res = await this.twoFactor.enable(this.who(req), dto.code);
    // ثبت کامل شد: توکن عادی (بدون محدودیت t2fa) برای همین نشست؛ کلاینت توکن قبلی را جایگزین می‌کند.
    if (a.type !== 'tenant_user') return res;
    const session = await this.auth.reissueSession({ sub: a.sub, tenantId: a.tenantId, membershipId: a.membershipId });
    return { ...res, accessToken: session.accessToken, twoFactor: session.twoFactor };
  }

  @Post('disable')
  disable(@Body() dto: TotpCodeDto, @Req() req: Request) {
    const sub = this.who(req);
    const t = req.ctx!.twoFactor;
    // وقتی سیاست الزام اعمال می‌شود (یا مهلت تمام شده) خاموش‌کردن 2FA معنایی ندارد و نشست را فوراً قفل می‌کند.
    if (t && wouldBeRestrictedWithout2FA(t)) throw twoFactorRequiredError();
    return this.twoFactor.disable(sub, dto.code);
  }
}
