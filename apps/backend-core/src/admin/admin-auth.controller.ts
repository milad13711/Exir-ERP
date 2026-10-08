import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService } from './admin-auth.service.js';
import { AdminLoginDto } from './dto/admin-login.dto.js';
import { AdminTotpDisableDto, AdminTotpEnableDto, AdminTotpLoginDto } from './dto/admin-totp.dto.js';
import { AdminChangePasswordDto, AdminUpdateProfileDto } from './dto/admin-account.dto.js';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard.js';
import { clientIp } from '../security/client-ip.js';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  login(@Body() dto: AdminLoginDto, @Req() req: Request) {
    return this.adminAuth.login(dto.email, dto.password, clientIp(req));
  }

  /** گام دوم ورود وقتی login مقدار requiresTotp برگردانده است. */
  @Post('login/totp')
  loginTotp(@Body() dto: AdminTotpLoginDto, @Req() req: Request) {
    return this.adminAuth.loginWithTotp(dto.challengeToken, dto.code, clientIp(req));
  }

  @Get('me')
  @UseGuards(AdminJwtAuthGuard)
  me(@Req() req: Request) {
    return this.adminAuth.me(req.adminCtx!.auth.sub);
  }

  /** تنها مسیر (کنار me) که نشست محدودِ «تغییر رمز اجباری» می‌تواند صدا بزند. توکن تازه برمی‌گرداند. */
  @Post('change-password')
  @UseGuards(AdminJwtAuthGuard)
  changePassword(@Body() dto: AdminChangePasswordDto, @Req() req: Request) {
    return this.adminAuth.changePassword(req.adminCtx!.auth.sub, dto.currentPassword, dto.newPassword, clientIp(req));
  }

  @Patch('profile')
  @UseGuards(AdminJwtAuthGuard)
  profile(@Body() dto: AdminUpdateProfileDto, @Req() req: Request) {
    return this.adminAuth.updateProfile(req.adminCtx!.auth.sub, dto, clientIp(req));
  }

  @Get('2fa/status')
  @UseGuards(AdminJwtAuthGuard)
  twoFaStatus(@Req() req: Request) {
    return this.adminAuth.status(req.adminCtx!.auth.sub);
  }

  @Post('2fa/setup')
  @UseGuards(AdminJwtAuthGuard)
  twoFaSetup(@Req() req: Request) {
    return this.adminAuth.beginSetup(req.adminCtx!.auth.sub);
  }

  @Post('2fa/enable')
  @UseGuards(AdminJwtAuthGuard)
  twoFaEnable(@Body() dto: AdminTotpEnableDto, @Req() req: Request) {
    return this.adminAuth.enable(req.adminCtx!.auth.sub, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(AdminJwtAuthGuard)
  twoFaDisable(@Body() dto: AdminTotpDisableDto, @Req() req: Request) {
    return this.adminAuth.disable(req.adminCtx!.auth.sub, dto.password, dto.code);
  }
}
