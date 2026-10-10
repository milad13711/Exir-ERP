import { Body, Controller, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicTrackingService } from './public-tracking.service.js';
import { RequestTrackingOtpDto } from './dto/request-tracking-otp.dto.js';
import { VerifyTrackingOtpDto } from './dto/verify-tracking-otp.dto.js';
import { ListTrackingProjectsDto } from './dto/list-tracking-projects.dto.js';

/** Unauthenticated by design — see PublicTrackingService for the OTP-gating rationale. */
@Controller('public/tracking/:slug')
export class PublicTrackingController {
  constructor(private readonly tracking: PublicTrackingService) {}

  @Post('otp/request')
  requestOtp(@Param('slug') slug: string, @Body() dto: RequestTrackingOtpDto) {
    return this.tracking.requestOtp(slug, dto.phone);
  }

  @Post('otp/verify')
  verifyOtp(@Param('slug') slug: string, @Body() dto: VerifyTrackingOtpDto) {
    return this.tracking.verifyOtp(slug, dto.phone, dto.code);
  }

  @Post('projects')
  listProjects(@Param('slug') slug: string, @Body() dto: ListTrackingProjectsDto) {
    return this.tracking.listProjects(slug, dto.trackingToken);
  }

  /** «پروژه‌های من» — خلاصه‌ی پروژه‌های دارای لینک عمومی روشن، با همان نشست OTP. */
  @Post('my-projects')
  async myProjects(@Param('slug') slug: string, @Body() dto: ListTrackingProjectsDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.tracking.listMyProjects(slug, dto.trackingToken);
  }
}
